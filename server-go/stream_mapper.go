package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"

	"github.com/mengelbart/moqtransport"
)

type streamMapper struct {
	localTrack  *moqtransport.LocalTrack
	mediaStream <-chan encodedFrame
}

func newStreamMapper(localTrack *moqtransport.LocalTrack, mediaStream <-chan encodedFrame) *streamMapper {
	return &streamMapper{localTrack, mediaStream}
}

func (sm *streamMapper) streamPerTrack() {
	// process frames
	currObjId := 0
	for frame := range sm.mediaStream {
		var buf bytes.Buffer
		serializeFrame(&buf, &frame)
		if err := sm.localTrack.WriteObject(context.Background(), moqtransport.Object{
			GroupID:              0,
			ObjectID:             uint64(currObjId),
			ObjectSendOrder:      0,
			ForwardingPreference: moqtransport.ObjectForwardingPreferenceStreamTrack,
			Payload:              buf.Bytes(),
		}); err != nil {
			panic(err)
		}
		currObjId++
	}
}

func (sm *streamMapper) streamPerGop() {
	// process frames
	groupId := uint64(0)
	objId := uint64(0)
	for frame := range sm.mediaStream {
		if frame.isKeyframe {
			fmt.Println("Increasing group ID w/ groupId = ", groupId)
			groupId++
			objId = 0
		}

		var buf bytes.Buffer
		serializeFrame(&buf, &frame)
		if err := sm.localTrack.WriteObject(context.Background(), moqtransport.Object{
			GroupID:              groupId,
			ObjectID:             objId,
			ObjectSendOrder:      0,
			ForwardingPreference: moqtransport.ObjectForwardingPreferenceStreamGroup,
			Payload:              buf.Bytes(),
		}); err != nil {
			panic(err)
		}
		objId++
	}
}

func serializeFrame(buf *bytes.Buffer, frame *encodedFrame) error {
	// Prepend availabilityTime to frame data
	err := binary.Write(buf, binary.BigEndian, frame.availabilityTime.UnixNano())
	if err != nil {
		return err
	}
	// The client-side mp4 library does not compute the presentation timestamp correctly
	// if we drop frames, so we include it in the payload of the MoQ object
	err = binary.Write(buf, binary.BigEndian, frame.presentationTime)
	if err != nil {
		return err
	}
	_, err = buf.Write(frame.data.Bytes())
	return err
}
