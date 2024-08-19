package main

import (
	"bytes"
	"io"
	"time"

	"github.com/Eyevinn/mp4ff/avc"
	"github.com/Eyevinn/mp4ff/mp4"
)

type encodedFrame struct {
	isKeyframe       bool
	ftype            avc.SliceType
	decodeTime       uint64
	presentationTime uint64
	availabilityTime time.Time
	data             bytes.Buffer
}

// represents a video stream in fMP4 (no audio)
type fragmentedMp4 struct {
	reader io.Reader

	ftyp *mp4.FtypBox
	moov *mp4.MoovBox

	// last moof box
	moof *mp4.MoofBox
}

func newFragmentedMp4(reader io.Reader) *fragmentedMp4 {
	return &fragmentedMp4{reader: reader}
}

func (s *fragmentedMp4) parseBoxes() (<-chan bytes.Buffer, <-chan encodedFrame) {
	initCh := make(chan bytes.Buffer)
	framesCh := make(chan encodedFrame)
	go func() {
		offset := uint64(0)
		for {
			// TODO: DecodeBox uses io.ReadFull.
			// TODO: Can it happen that the writer lags behind the reader, so that io.ReadFull returns an EOF error?
			box, err := mp4.DecodeBox(offset, s.reader)
			if err != nil {
				if err == io.EOF {
					// fmt.Println("EOF: Stream ended")
					return
				}
				panic(err)
			}
			s.handleBox(initCh, framesCh, box)
			offset += box.Size()
		}
	}()
	return initCh, framesCh
}

func (s *fragmentedMp4) handleBox(initCh chan bytes.Buffer, framesCh chan encodedFrame, box mp4.Box) {
	switch box := box.(type) {
	case *mp4.FtypBox:
		s.ftyp = box
	case *mp4.MoovBox:
		s.moov = box
		// write ftyp and moov boxes as the first item to the stream
		var buf bytes.Buffer
		if err := s.ftyp.Encode(&buf); err != nil {
			panic(err)
		}
		if err := s.moov.Encode(&buf); err != nil {
			panic(err)
		}
		go func() { initCh <- buf }()
	case *mp4.MoofBox:
		s.moof = box
	case *mp4.MdatBox:
		// write each fragment (one frame) as an individual item
		var buf bytes.Buffer
		if err := s.moof.Encode(&buf); err != nil {
			panic(err)
		}
		if err := box.Encode(&buf); err != nil {
			panic(err)
		}

		frag := mp4.NewFragment()
		frag.AddChild(s.moof)
		frag.AddChild(box)
		samples, err := frag.GetFullSamples(nil)
		if err != nil {
			panic(err)
		}

		// we assume that each fragment contains exactly one sample
		// this can be configured in ffmpeg with the +frag_every_frame option
		sample := samples[0]
		nalus, err := avc.GetNalusFromSample(sample.Data)
		if err != nil {
			panic(err)
		}
		var vclNalu []byte
		for _, nalu := range nalus {
			naluType := avc.GetNaluType(nalu[0])
			if naluType == avc.NALU_NON_IDR || naluType == avc.NALU_IDR {
				vclNalu = nalu
				break
			}
		}
		// we also assume that each sample consists of slices of the same type
		ftype, err := avc.GetSliceTypeFromNALU(vclNalu)
		if err != nil {
			panic(err)
		}

		framesCh <- encodedFrame{
			data:             buf,
			ftype:            ftype,
			isKeyframe:       isKeyframe(s.moof.Traf.Trun.Samples[0].Flags),
			decodeTime:       sample.DecodeTime,
			presentationTime: sample.PresentationTime(),
			availabilityTime: time.Now(),
		}
	}
}

// the frag_every_frame option is set, so each fragment contains only one sample
// see 8.31 Track Extends Box in https://web.archive.org/web/20180219054429/http://l.web.umkc.edu/lizhu/teaching/2016sp.video-communication/ref/mp4.pdf
// https://github.com/kixelated/moq-rs/blob/main/moq-pub/src/media.rs#L391
func isKeyframe(flags uint32) bool {
	// f := mp4.DecodeSampleFlags(flags)
	// flags := moof.Traf.Trun.Samples[0].Flags
	isDependedOn := (flags>>24)&0x3 == 0x2
	isDifferenceSample := (flags>>16)&0x1 == 0x1
	return isDependedOn && !isDifferenceSample
}
