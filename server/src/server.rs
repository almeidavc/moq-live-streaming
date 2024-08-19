use std::{future::Future, net, pin::Pin};

use anyhow::Context;
use futures::{stream::FuturesUnordered, FutureExt, StreamExt};
use moq_native::quic;
use moq_transport::{
    serve::{ServeError, TracksReader},
    session::{Publisher, Session, SessionError, Subscribed},
};

use crate::local::Locals;

pub struct ServerConfig {
    /// Listen on this address
    pub bind: net::SocketAddr,

    /// The TLS configuration.
    pub tls: moq_native::tls::Config,
}

pub struct Server {
    quic: quic::Endpoint,
    locals: Locals,
    // just so it is not dropped
    _namespace: TracksReader,
}

impl Server {
    pub async fn new(config: ServerConfig, namespace: TracksReader) -> anyhow::Result<Self> {
        let quic = quic::Endpoint::new(quic::Config {
            bind: config.bind,
            tls: config.tls,
        })?;

        let mut locals = Locals::new();
        locals.register(namespace.clone()).await?;

        Ok(Self {
            quic,
            locals,
            _namespace: namespace,
        })
    }

    pub async fn run(self) -> anyhow::Result<()> {
        let mut tasks: FuturesUnordered<
            Pin<Box<dyn Future<Output = Result<(), anyhow::Error>> + Send>>,
        > = FuturesUnordered::new();

        let mut server = self.quic.server.context("missing TLS certificate")?;
        log::info!("listening on {}", server.local_addr()?);

        loop {
            tokio::select! {
                res = server.accept() => {
                    let conn = res.context("failed to accept QUIC connection")?;

                    let locals = self.locals.clone();

                    tasks.push(async move {
                        let (session, publisher, _) = match Session::accept(conn).await {
                            Ok(session) => session,
                            Err(err) => {
                                log::warn!("failed to accept MoQ session: {}", err);
                                return Ok(());
                            }
                        };
                        log::info!("established MoQ session");

                        let producer = Producer::new(publisher.unwrap(), locals);
                        let mut tasks = FuturesUnordered::new();
                        tasks.push(session.run().boxed());
                        tasks.push(producer.run().boxed());

                        log::info!("running MoQ session");
                        if let Err(err) = tasks.select_next_some().await {
                            log::warn!("failed to run MoQ session: {}", err);
                        }

                        Ok(())
                    }.boxed());
                },
                res = tasks.next(), if !tasks.is_empty() => res.unwrap()?,
            }
        }
    }
}

#[derive(Clone)]
pub struct Producer {
    publisher: Publisher,
    locals: Locals,
}

impl Producer {
    pub fn new(publisher: Publisher, locals: Locals) -> Self {
        Self { publisher, locals }
    }

    pub async fn run(mut self) -> Result<(), SessionError> {
        let mut tasks = FuturesUnordered::new();

        loop {
            tokio::select! {
                Some(subscribe) = self.publisher.subscribed() => {
                    let this = self.clone();

                    tasks.push(async move {
                        let info = subscribe.clone();
                        log::info!("serving subscribe: {:?}", info);

                        if let Err(err) = this.serve(subscribe).await {
                            log::warn!("failed serving subscribe: {:?}, error: {}", info, err)
                        }
                    })
                },
                _= tasks.next(), if !tasks.is_empty() => {},
                else => return Ok(()),
            };
        }
    }

    async fn serve(self, subscribe: Subscribed) -> Result<(), anyhow::Error> {
        if let Some(mut local) = self.locals.route(&subscribe.namespace) {
            if let Some(track) = local.subscribe(&subscribe.name) {
                log::info!("serving from local: {:?}", track.info);
                return Ok(subscribe.serve(track).await?);
            }
        }

        Err(ServeError::NotFound.into())
    }
}
