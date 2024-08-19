use crate::video::{next_item, parse_item, serialize_frame, MediaStreamItem, VideoStreamer};
use anyhow::Result;
use bytes::BytesMut;
use moq_transport::serve::{StreamGroupWriter, StreamWriter, TracksWriter};

pub struct StreamPerTrack {
    init_track: StreamGroupWriter,
    video_track: StreamWriter,
    current_group: StreamGroupWriter,
}

impl VideoStreamer for StreamPerTrack {
    fn new(mut namespace: TracksWriter) -> anyhow::Result<Self> {
        let init_track = namespace
            .create("init")
            .ok_or_else(|| anyhow::anyhow!("Failed to create init track"))?
            .stream(0)?
            .append()?;

        let mut video_track = namespace
            .create("video")
            .ok_or_else(|| anyhow::anyhow!("Failed to create video track"))?
            .stream(0)?;

        let current_group = video_track.append()?;

        Ok(StreamPerTrack {
            init_track,
            video_track,
            current_group,
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
                        self.current_group = self.video_track.append()?;
                    }

                    let mut payload = BytesMut::new();
                    serialize_frame(&frame, &mut payload)?;
                    self.current_group.write(payload.freeze())?;
                }
            }
        }
        Ok(())
    }
}
