# Live-Streaming System using Media over QUIC (MoQ)

This repository contains the source code for my B.Sc. thesis project. The goal was to explore
ways of leveraging QUIC and in particular Media over QUIC to build a live-streaming latency
that prioritizes latency.

In this repository, you will find:

- `client/`: A javascript client that plays the live video stream
- `server/`: An origin server that ingests a live stream from `stdin` and broadcasts it to clients
- `testbed/`: A testbed to simulate network conditions and collect relevant metrics
