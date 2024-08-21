package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/mengelbart/moqtransport"
	"github.com/mengelbart/moqtransport/webtransportmoq"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

type livestreamServer struct {
	init       bytes.Buffer
	videoTrack *moqtransport.LocalTrack
}

func newLivestreamServer() *livestreamServer {
	return &livestreamServer{
		videoTrack: moqtransport.NewLocalTrack("livestream", "video"),
	}
}

func (s *livestreamServer) run() {
	go func() {
		reader := bufio.NewReader(os.Stdin)
		initCh, framesCh := newFragmentedMp4(reader).parseBoxes()
		s.init = <-initCh
		newStreamMapper(s.videoTrack, framesCh).streamPerGop()
	}()

	go func() { runCertHashServer() }()

	wt := webtransport.Server{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
		H3: http3.Server{
			Addr:      ":443",
			TLSConfig: loadTLSConfigWithCert(),
		},
	}
	http.HandleFunc("/moq", func(w http.ResponseWriter, r *http.Request) {
		session, err := wt.Upgrade(w, r)
		if err != nil {
			log.Printf("upgrading failed: %s", err)
			w.WriteHeader(500)
			return
		}
		go s.handleConnection(webtransportmoq.New(session))
	})
	if err := wt.ListenAndServe(); err != nil {
		panic(err)
	}
}

func (s *livestreamServer) handleConnection(connection moqtransport.Connection) {
	session := &moqtransport.Session{
		Conn:                connection,
		EnableDatagrams:     false,
		LocalRole:           0,
		RemoteRole:          0,
		AnnouncementHandler: nil,
		SubscriptionHandler: moqtransport.SubscriptionHandlerFunc(func(ses *moqtransport.Session, sub *moqtransport.Subscription, srw moqtransport.SubscriptionResponseWriter) {
			s.handleSubscription(ses, sub, srw)
		}),
		Path: "",
	}
	if err := session.RunServer(context.Background()); err != nil {
		panic(err)
	}
	select {}
}

func (s *livestreamServer) handleSubscription(ses *moqtransport.Session, sub *moqtransport.Subscription, srw moqtransport.SubscriptionResponseWriter) {
	fmt.Println("Received Subscription.")
	fmt.Println("ID:", sub.ID)
	fmt.Println("Namespace:", sub.Namespace)
	fmt.Println("Trackname:", sub.TrackName)

	if sub.Namespace == "livestream" && sub.TrackName == "init" {
		initTrack := moqtransport.NewLocalTrack("livestream", "init")
		srw.Accept(initTrack)
		if err := initTrack.WriteObject(context.Background(), moqtransport.Object{
			GroupID:              0,
			ObjectID:             0,
			ObjectSendOrder:      0,
			ForwardingPreference: moqtransport.ObjectForwardingPreferenceStream,
			Payload:              s.init.Bytes(),
		}); err != nil {
			panic(err)
		}
	}

	if sub.Namespace == "livestream" && sub.TrackName == "video" {
		srw.Accept(s.videoTrack)
		// TODO: is this how the API is intended to be used?
		// so that Unsubscribe works
		ses.AddLocalTrack(s.videoTrack)
	}
}
