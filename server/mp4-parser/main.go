package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
)

// func main() {
// 	reader := bufio.NewReader(os.Stdin)
// 	initCh, framesCh := newFragmentedMp4(reader).parseBoxes()
// 	init := <-initCh

// 	writer := bufio.NewWriter(os.Stdout)
// 	defer writer.Flush()
// 	serializeInit(writer, init)
// 	for frame := range framesCh {
// 		serializeEncodedFrame(writer, frame)
// 		writer.Flush()
// 	}
// }

func main() {
	test()
}

func serializeInit(writer *bufio.Writer, init bytes.Buffer) {
	// Write null byte (0x00)
	if err := writer.WriteByte(0x00); err != nil {
		panic(err)
	}
	// Write length of init (4 bytes)
	initLen := uint32(init.Len())
	if err := binary.Write(writer, binary.BigEndian, initLen); err != nil {
		panic(err)
	}
	// Write init data
	if _, err := writer.Write(init.Bytes()); err != nil {
		panic(err)
	}
	writer.Flush()
}

func serializeEncodedFrame(writer *bufio.Writer, frame encodedFrame) {
	// Write frame identifier byte (0x01)
	if err := writer.WriteByte(0x01); err != nil {
		panic(err)
	}
	// Write isKeyframe (1 byte)
	if err := writer.WriteByte(boolToByte(frame.isKeyframe)); err != nil {
		panic(err)
	}
	if err := writer.WriteByte(byte(frame.ftype)); err != nil {
		panic(err)
	}
	// Write availabilityTime (8 bytes)
	if err := binary.Write(writer, binary.BigEndian, frame.availabilityTime.UnixNano()); err != nil {
		panic(err)
	}
	if err := binary.Write(writer, binary.BigEndian, frame.decodeTime); err != nil {
		panic(err)
	}
	// Write presentationTime (8 bytes)
	if err := binary.Write(writer, binary.BigEndian, frame.presentationTime); err != nil {
		panic(err)
	}
	// Write data length (4 bytes)
	dataLen := uint32(frame.data.Len())
	if err := binary.Write(writer, binary.BigEndian, dataLen); err != nil {
		panic(err)
	}
	// Write data
	if _, err := writer.Write(frame.data.Bytes()); err != nil {
		panic(err)
	}
}

func boolToByte(b bool) byte {
	if b {
		return 1
	}
	return 0
}
