#!/bin/bash

PORT="[::]:443"
CERT="../../moq-streaming/moq-streaming-server/cert/localhost.crt"
KEY="../../moq-streaming/moq-streaming-server/cert/localhost.key"

cargo run -- --bind "$PORT" --tls-cert "$CERT" --tls-key "$KEY"
