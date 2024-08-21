package main

import (
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net/http"
)

func loadTLSConfigWithCert() *tls.Config {
	cert, err := tls.LoadX509KeyPair("./cert/localhost.crt", "./cert/localhost.key")
	if err != nil {
		panic(err)
	}
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		NextProtos:   []string{"moq-00"},
	}
}

func runCertHashServer() {
	mux := http.NewServeMux()
	mux.HandleFunc("/cert-hash", func(w http.ResponseWriter, r *http.Request) {
		cert, err := tls.LoadX509KeyPair("./cert/localhost.crt", "./cert/localhost.key")
		if err != nil {
			panic(err)
		}
		fp := sha256.Sum256(cert.Certificate[0])
		s := base64.StdEncoding.EncodeToString(fp[:])

		w.Header().Set("Access-Control-Allow-Origin", "*")
		_, err = fmt.Fprint(w, s)
		if err != nil {
			fmt.Println("Something went wrong.")
			w.WriteHeader(500)
			return
		}
	})
	if err := http.ListenAndServe(":80", mux); err != nil {
		panic(err)
	}
}
