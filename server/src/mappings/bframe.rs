use crate::video::{
    next_item, parse_item, serialize_frame, FrameType, MediaStreamItem, VideoStreamer,
};
use anyhow::Result;
use bytes::BytesMut;
use moq_transport::serve::{
    GroupWriter, GroupsWriter, Object, ObjectsWriter, StreamGroupWriter, TracksWriter,
};

pub struct StreamPerBFrame {
    init_track: StreamGroupWriter,

    video_track: GroupsWriter,
    current: GroupWriter,

    b_frames_track: ObjectsWriter,
    b_group: u32,
    b_frame_index: u32,
    group_id: u64,
    obj_id: u64,
}

impl VideoStreamer for StreamPerBFrame {
    fn new(mut namespace: TracksWriter) -> anyhow::Result<Self> {
        let init_track = namespace
            .create("init")
            .ok_or_else(|| anyhow::anyhow!("Failed to create init track"))?
            .stream(0)?
            .append()?;
        let mut video_track = namespace
            .create("video")
            .ok_or_else(|| anyhow::anyhow!("Failed to create video track"))?
            .groups()?;
        let current = video_track.append(i32::MAX.try_into().unwrap())?;

        let b_frames_track = namespace
            .create("b-frames")
            .ok_or_else(|| anyhow::anyhow!("Failed to create video track"))?
            .objects()?;

        Ok(StreamPerBFrame {
            init_track,
            video_track,
            current,

            b_frames_track,
            b_group: 0,
            b_frame_index: 0,
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
                    let mut payload = BytesMut::new();
                    serialize_frame(&frame, &mut payload)?;

                    if frame.is_keyframe {
                        self.group_id += 1;
                        self.current = self.video_track.append(i32::MAX.try_into().unwrap())?;
                    }

                    if frame.frame_type != FrameType::B {
                        self.b_group = self
                            .b_group
                            .checked_add(1)
                            .ok_or_else(|| anyhow::anyhow!("P-group counter overflow"))?;
                        self.b_frame_index = 0;
                    }

                    if frame.frame_type == FrameType::B {
                        // prioritize newer B-frames over older ones
                        // let priority = u32::MAX
                        //     .checked_sub(frame.decode_time.try_into().unwrap())
                        //     .ok_or_else(|| anyhow::anyhow!("Priority overflow"))?;

                        // prioritize newer "B-groups" over older ones,
                        // and prioritize older B-frames over newer ones within the same "B-group"
                        // let max_b_group: u32 = 0x3FFFFFF; // 26 bits for B-group
                        // if self.b_group >= max_b_group {
                        //     return Err(anyhow::anyhow!("Max value for P-group exceeded"));
                        // }
                        // let max_b_frame_index: u32 = 0x3F; // 6 bits for B-frame index
                        // if self.b_frame_index > max_b_frame_index {
                        //     return Err(anyhow::anyhow!("Max value for b-frame index exceeded"));
                        // }
                        // let priority = ((max_b_group - self.b_group) << 6) | self.b_frame_index;
                        // test if higher value <=> higher priority
                        let max_b_group: u32 = 0x1FFFFFF; // 25 bits for B-group
                        if self.b_group >= max_b_group {
                            return Err(anyhow::anyhow!("Max value for P-group exceeded"));
                        }
                        let max_b_frame_index: u32 = 0x3F; // 6 bits for B-frame index
                        if self.b_frame_index > max_b_frame_index {
                            return Err(anyhow::anyhow!("Max value for b-frame index exceeded"));
                        }
                        let priority =
                            ((self.b_group) << 6) | max_b_frame_index - self.b_frame_index;

                        self.b_frames_track.write(
                            Object {
                                group_id: self.group_id,
                                object_id: self.obj_id,
                                priority: priority.into(),
                            },
                            payload.freeze(),
                        )?;
                        self.obj_id += 1;
                        self.b_frame_index += 1;
                    } else {
                        self.current.write(payload.freeze())?;
                    }
                }
            }
        }
        Ok(())
    }
}
