mod local;
mod mappings;
mod server;
mod video;

use anyhow::Context;
use bytes::BytesMut;
use clap::Parser;
use mappings::StreamPerFrameType;
use moq_transport::serve::Tracks;
use server::*;
use std::net;
use tokio::io::AsyncReadExt;
use video::VideoStreamer;

use crate::mappings::{StreamPerBFrame, StreamPerGop, StreamPerTrack};

#[derive(Parser, Clone)]
pub struct Cli {
    /// Listen on this address
    #[arg(long, default_value = "[::]:443")]
    pub bind: net::SocketAddr,
    /// The TLS configuration.
    #[command(flatten)]
    pub tls: moq_native::tls::Args,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::init();
    let tracer = tracing_subscriber::FmtSubscriber::builder()
        .with_max_level(tracing::Level::WARN)
        .finish();
    tracing::subscriber::set_global_default(tracer).unwrap();

    let cli = Cli::parse();
    let tls = cli.tls.load()?;
    if tls.server.is_none() {
        anyhow::bail!("missing TLS certificates");
    }

    let namespace = Tracks::new("livestream".to_string());
    let (tracks_writer, _, tracks_reader) = namespace.produce();

    let server = Server::new(
        ServerConfig {
            bind: cli.bind,
            tls: tls.clone(),
        },
        tracks_reader,
    )
    .await?;

    let video = StreamPerTrack::new(tracks_writer)?;

    tokio::select! {
        res = server.run() => res.context("session error")?,
        res = read_video(video) => res.context("media error")?,
    }

    Ok(())
}

async fn read_video<T: VideoStreamer>(mut video: T) -> anyhow::Result<()> {
    let mut input = tokio::io::stdin();
    let mut buf = BytesMut::new();
    loop {
        input
            .read_buf(&mut buf)
            .await
            .context("failed to read from stdin")?;
        video.stream(&mut buf).context("failed to parse media")?;
    }
}
