use crate::video::{next_item, parse_item, serialize_frame, MediaStreamItem, VideoStreamer};
use anyhow::Result;
use bytes::BytesMut;
use moq_transport::serve::{GroupWriter, GroupsWriter, StreamGroupWriter, TracksWriter};

pub struct StreamPerGop {
    init_track: StreamGroupWriter,
    video_track: GroupsWriter,
    current_group: Option<GroupWriter>,
    group: u32,
}

impl VideoStreamer for StreamPerGop {
    fn new(mut namespace: TracksWriter) -> anyhow::Result<Self> {
        let init_track = namespace
            .create("init")
            .ok_or_else(|| anyhow::anyhow!("Failed to create init track"))?
            .stream(0)?
            .append()?;
        let video_track = namespace
            .create("video")
            .ok_or_else(|| anyhow::anyhow!("Failed to create video track"))?
            .groups()?;
        Ok(StreamPerGop {
            init_track,
            video_track,
            current_group: None,
            group: 0,
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
                    if frame.is_keyframe {
                        // let priority: u32 = i32::MAX
                        //     .checked_sub(self.group as i32)
                        //     .unwrap()
                        //     .try_into()
                        //     .unwrap();
                        let priority = self.group;
                        log::info!("group: {}", self.group);
                        self.current_group = Some(self.video_track.append(priority.into())?);
                        self.group += 1;
                    }

                    let current_group = self
                        .current_group
                        .as_mut()
                        .ok_or_else(|| anyhow::anyhow!("No current group"))?;

                    let mut payload = BytesMut::new();
                    serialize_frame(&frame, &mut payload)?;
                    current_group.write(payload.freeze())?;
                }
            }
        }
        Ok(())
    }
}
