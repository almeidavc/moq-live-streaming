use crate::video::{
    next_item, parse_item, serialize_frame, serialize_frame_info, FrameInfo, FrameType,
    MediaStreamItem, VideoStreamer,
};
use anyhow::Result;
use bytes::BytesMut;
use moq_transport::serve::{Object, ObjectsWriter, StreamGroupWriter, StreamWriter, TracksWriter};

pub struct StreamPerFrameType {
    init_track: StreamGroupWriter,
    video_track: ObjectsWriter,
    frames_track: StreamWriter,
    current: StreamGroupWriter,
    group_id: u64,
    obj_id: u64,
}

impl VideoStreamer for StreamPerFrameType {
    fn new(mut namespace: TracksWriter) -> anyhow::Result<Self> {
        let init_track = namespace
            .create("init")
            .ok_or_else(|| anyhow::anyhow!("Failed to create init track"))?
            .stream(0)?
            .append()?;
        let video_track = namespace
            .create("video")
            .ok_or_else(|| anyhow::anyhow!("Failed to create video track"))?
            .objects()?;
        let mut frames_track = namespace
            .create("frames")
            .ok_or_else(|| anyhow::anyhow!("Failed to create init track"))?
            .stream(1)?;
        let current = frames_track.append()?;

        Ok(StreamPerFrameType {
            init_track,
            video_track,
            frames_track,
            current,
            group_id: 0,
            obj_id: 0,
        })
    }

    fn stream(&mut self, buf: &mut BytesMut) -> Result<()> {
        while next_item(buf)? {
            let item = parse_item(buf)?;
            match item {
                MediaStreamItem::InitSegment(data) => {
                    self.init_track.write(data)?;
                }
                MediaStreamItem::Frame(frame) => {
                    let priority = match frame.frame_type {
                        FrameType::I => 2,
                        FrameType::P => 2,
                        FrameType::B => {
                            let timestamp = frame.decode_time;
                            let max_value = (1u64 << 30) - 1;
                            if timestamp > max_value {
                                return Err(anyhow::anyhow!(
                                    "Timestamp overflow in priority calculation"
                                ));
                            }
                            (2 << 30) + (max_value - timestamp)
                        }
                    };

                    if frame.is_keyframe {
                        self.group_id += 1;
                        self.current = self.frames_track.append()?;
                    }

                    // write frame info to frames track
                    let mut infoPayload = BytesMut::new();
                    serialize_frame_info(
                        FrameInfo {
                            ftype: frame.frame_type,
                            dts: frame.decode_time,
                        },
                        &mut infoPayload,
                    )?;
                    self.current.write(infoPayload.freeze())?;

                    // write frame to video track
                    let mut payload = BytesMut::new();
                    serialize_frame(&frame, &mut payload)?;
                    self.video_track.write(
                        Object {
                            group_id: self.group_id,
                            object_id: self.obj_id,
                            priority,
                        },
                        payload.freeze(),
                    )?;
                    self.obj_id += 1;
                }
            }
        }
        Ok(())
    }
}
