# Pin the builder to the *host's* architecture and let Go cross-compile to the
# target. The control machine is arm64 and the VMs are amd64; without
# --platform=$BUILDPLATFORM buildx would run this whole stage under QEMU
# emulation, which is drastically slower than a native Go cross-compile.
# CGO_ENABLED=0 is what makes cross-compiling free.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS builder
ARG TARGETARCH
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -o server .

FROM alpine:latest
# tzdata is required: parseCentralTime() calls time.LoadLocation("America/Chicago"),
# which reads /usr/share/zoneinfo. Without it every event create/update fails.
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/server .
EXPOSE 8080
CMD ["./server"]
