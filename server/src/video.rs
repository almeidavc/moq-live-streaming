use anyhow::Result;
use bytes::{Buf, BufMut, Bytes, BytesMut};
use moq_transport::serve::TracksWriter;
use std::{
    io::{Cursor, Seek, SeekFrom},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub enum MediaStreamItem {
    InitSegment(Bytes),
    Frame(Frame),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FrameType {
    P = 0,
    B = 1,
    I = 2,
}

pub struct Frame {
    pub is_keyframe: bool,
    pub frame_type: FrameType,
    pub availability_time: SystemTime,
    pub decode_time: u64,
    pub presentation_time: u64,
    pub data: Bytes,
}

impl TryFrom<u8> for FrameType {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(FrameType::P),
            1 => Ok(FrameType::B),
            2 => Ok(FrameType::I),
            _ => Err(anyhow::anyhow!("Invalid frame type")),
        }
    }
}

pub trait VideoStreamer {
    fn new(namespace: TracksWriter) -> anyhow::Result<Self>
    where
        Self: Sized;
    fn stream(&mut self, buf: &mut BytesMut) -> Result<()>;
}

const FRAME_HEADER: usize = 1 + 1 + 8 + 8 + 8 + 4;
pub fn next_item(buf: &mut BytesMut) -> anyhow::Result<bool> {
    let mut peek = Cursor::new(buf.chunk());
    if peek.remaining() < 1 {
        return Ok(false);
    }
    let segment_type = peek.get_u8();
    match segment_type {
        0x00 => {
            if peek.remaining() < 4 {
                return Ok(false);
            }
            let size = peek.get_u32() as usize;
            if peek.remaining() < size {
                return Ok(false);
            }
        }
        0x01 => {
            if peek.remaining() < FRAME_HEADER {
                return Ok(false);
            }
            peek.seek(SeekFrom::Current((FRAME_HEADER - 4) as i64))?;
            let size = peek.get_u32() as usize;
            if peek.remaining() < size {
                return Ok(false);
            }
        }
        _ => return Err(anyhow::anyhow!("Unknown segment type")),
    }
    Ok(true)
}

pub fn parse_item(buf: &mut BytesMut) -> anyhow::Result<MediaStreamItem> {
    let segment_type = buf.get_u8();
    match segment_type {
        0x00 => {
            let size = buf.get_u32() as usize;
            let data = buf.split_to(size).freeze();
            Ok(MediaStreamItem::InitSegment(data))
        }
        0x01 => {
            let frame = parse_frame(buf)?;
            Ok(MediaStreamItem::Frame(frame))
        }
        _ => Err(anyhow::anyhow!("Unknown segment type")),
    }
}

pub fn parse_frame(buf: &mut BytesMut) -> anyhow::Result<Frame> {
    let is_keyframe = buf.get_u8() != 0;
    let frame_type = FrameType::try_from(buf.get_u8())?;
    let availability_time = UNIX_EPOCH + Duration::from_nanos(buf.get_u64());
    let decode_time = buf.get_u64();
    let presentation_time = buf.get_u64();
    let size = buf.get_u32() as usize;
    let data = buf.split_to(size).freeze();

    Ok(Frame {
        is_keyframe,
        frame_type,
        availability_time,
        decode_time,
        presentation_time,
        data,
    })
}

pub fn serialize_frame(frame: &Frame, buf: &mut BytesMut) -> Result<()> {
    buf.put_u8(frame.frame_type as u8);
    buf.extend_from_slice(
        &frame
            .availability_time
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .to_be_bytes()[8..],
    );
    buf.extend_from_slice(&frame.decode_time.to_be_bytes());
    buf.extend_from_slice(&frame.presentation_time.to_be_bytes());
    buf.extend_from_slice(&frame.data);
    Ok(())
}

pub struct FrameInfo {
    pub ftype: FrameType,
    pub dts: u64,
}

pub fn serialize_frame_info(info: FrameInfo, buf: &mut BytesMut) -> Result<()> {
    buf.put_u8(info.ftype as u8);
    buf.extend_from_slice(&info.dts.to_be_bytes());
    Ok(())
}
