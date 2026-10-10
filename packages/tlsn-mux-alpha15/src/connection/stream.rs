// Copyright (c) 2018-2019 Parity Technologies (UK) Ltd.
// Modifications Copyright (c) 2026 TLSNotary
//
// Licensed under the Apache License, Version 2.0 or MIT license, at your
// option.
//
// A copy of the Apache License, Version 2.0 is included in the software as
// LICENSE-APACHE and a copy of the MIT license is included in the software
// as LICENSE-MIT. You may also obtain a copy of the Apache License, Version 2.0
// at https://www.apache.org/licenses/LICENSE-2.0 and a copy of the MIT license
// at https://opensource.org/licenses/MIT.

use crate::{
    Config, DEFAULT_CREDIT,
    chunks::Chunks,
    connection::{self, StreamCommand, UserId, rtt, rtt::Rtt},
    frame::{Frame, header::StreamId},
};
use flow_control::FlowController;
use futures::{
    SinkExt,
    channel::mpsc,
    io::{AsyncRead, AsyncWrite},
    ready,
};
use parking_lot::{Mutex, MutexGuard};
use std::{
    fmt, io,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll, Waker},
};

mod flow_control;

/// The state of a stream.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum State {
    /// Open bidirectionally.
    Open,
    /// Open for incoming messages (local sent FIN).
    SendClosed,
    /// Open for outgoing messages (remote sent FIN).
    RecvClosed,
    /// Closed (terminal state).
    Closed,
}

impl State {
    /// Can we receive messages over this stream?
    pub fn can_read(self) -> bool {
        matches!(self, State::Open | State::SendClosed)
    }

    /// Can we send messages over this stream?
    pub fn can_write(self) -> bool {
        matches!(self, State::Open | State::RecvClosed)
    }
}

/// A multiplexed stream.
///
/// Streams are created via [`crate::Connection::new_stream`].
///
/// `Stream` implements [`AsyncRead`] and [`AsyncWrite`].
pub struct Stream {
    stream_id: StreamId,
    user_id: UserId,
    conn: connection::Id,
    config: Arc<Config>,
    sender: mpsc::Sender<StreamCommand>,
    shared: Arc<Mutex<Shared>>,
}

impl fmt::Debug for Stream {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.debug_struct("Stream")
            .field("stream_id", &self.stream_id)
            .field("user_id", &self.user_id)
            .field("connection", &self.conn)
            .finish()
    }
}

impl fmt::Display for Stream {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "(Stream {}/{})", self.conn, self.stream_id)
    }
}

impl Stream {
    /// Create a new stream.
    pub(crate) fn new(
        stream_id: StreamId,
        user_id: UserId,
        conn: connection::Id,
        config: Arc<Config>,
        sender: mpsc::Sender<StreamCommand>,
        rtt: rtt::Rtt,
        accumulated_max_stream_windows: Arc<Mutex<usize>>,
    ) -> Self {
        Self {
            stream_id,
            user_id,
            conn,
            config: config.clone(),
            sender,
            shared: Arc::new(Mutex::new(Shared::new(
                State::Open,
                DEFAULT_CREDIT,
                DEFAULT_CREDIT,
                accumulated_max_stream_windows,
                rtt,
                config,
            ))),
        }
    }

    /// Create a stream with existing shared state (for merging with implicit
    /// stream).
    pub(crate) fn with_shared(
        stream_id: StreamId,
        user_id: UserId,
        conn: connection::Id,
        config: Arc<Config>,
        sender: mpsc::Sender<StreamCommand>,
        shared: Arc<Mutex<Shared>>,
    ) -> Self {
        Self {
            stream_id,
            user_id,
            conn,
            config,
            sender,
            shared,
        }
    }

    /// Get this stream's user-defined identifier.
    pub fn id(&self) -> &[u8] {
        self.user_id.as_bytes()
    }

    /// Get the stream ID.
    pub fn stream_id(&self) -> StreamId {
        self.stream_id
    }

    pub fn is_write_closed(&self) -> bool {
        matches!(self.shared().state(), State::SendClosed)
    }

    pub fn is_closed(&self) -> bool {
        matches!(self.shared().state(), State::Closed)
    }

    pub(crate) fn shared(&self) -> MutexGuard<'_, Shared> {
        self.shared.lock()
    }

    pub(crate) fn clone_shared(&self) -> Arc<Mutex<Shared>> {
        self.shared.clone()
    }

    fn write_zero_err(&self) -> io::Error {
        let msg = format!("{}: connection is closed", self);
        io::Error::new(io::ErrorKind::WriteZero, msg)
    }

    /// Send new credit to the sending side via a window update message if
    /// permitted.
    fn send_window_update(&mut self, cx: &mut Context) -> Poll<io::Result<()>> {
        if !self.shared.lock().state.can_read() {
            return Poll::Ready(Ok(()));
        }

        ready!(
            self.sender
                .poll_ready(cx)
                .map_err(|_| self.write_zero_err())?
        );

        let mut shared = self.shared.lock();
        let Some(credit) = shared.next_window_update() else {
            return Poll::Ready(Ok(()));
        };
        drop(shared);

        let frame = Frame::window_update(self.stream_id, credit);
        let cmd = StreamCommand::SendFrame(frame.into());
        self.sender
            .start_send(cmd)
            .map_err(|_| self.write_zero_err())?;

        Poll::Ready(Ok(()))
    }
}

impl AsyncRead for Stream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context,
        buf: &mut [u8],
    ) -> Poll<io::Result<usize>> {
        // Try to send window update, but don't fail if sender is closed
        match self.send_window_update(cx) {
            Poll::Ready(Ok(())) => {}
            Poll::Ready(Err(_)) if self.sender.is_closed() => {}
            Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
            Poll::Pending => {}
        }

        let mut shared = self.shared();

        // Copy data from stream buffer
        let mut n = 0;
        while let Some(chunk) = shared.buffer.front_mut() {
            if chunk.is_empty() {
                shared.buffer.pop();
                continue;
            }
            let k = std::cmp::min(chunk.len(), buf.len() - n);
            buf[n..n + k].copy_from_slice(&chunk.as_ref()[..k]);
            n += k;
            chunk.advance(k);
            if n == buf.len() {
                break;
            }
        }

        if n > 0 {
            log::trace!("{}: read {} bytes", self, n);
            return Poll::Ready(Ok(n));
        }

        // Buffer is empty, check if sender is closed
        if !self.config.read_after_close && self.sender.is_closed() {
            return Poll::Ready(Ok(0));
        }

        // Buffer is empty, check if we can expect to read more data
        if !shared.state().can_read() {
            log::debug!("{}: eof", self);
            return Poll::Ready(Ok(0));
        }

        // Wait for more data
        shared.reader = Some(cx.waker().clone());
        Poll::Pending
    }
}

impl AsyncWrite for Stream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        ready!(
            self.sender
                .poll_ready(cx)
                .map_err(|_| self.write_zero_err())?
        );

        let stream_id = self.stream_id;
        let body = {
            let mut shared = self.shared();
            if !shared.state().can_write() {
                log::debug!("{}: can no longer write", self);
                return Poll::Ready(Err(self.write_zero_err()));
            }
            if shared.send_window() == 0 {
                log::trace!("{}: no more credit left", self);
                shared.writer = Some(cx.waker().clone());
                return Poll::Pending;
            }
            let k = std::cmp::min(
                shared.send_window(),
                buf.len().try_into().unwrap_or(u32::MAX),
            );
            let k = std::cmp::min(
                k,
                self.config.split_send_size.try_into().unwrap_or(u32::MAX),
            );
            shared.consume_send_window(k);
            Vec::from(&buf[..k as usize])
        };
        let n = body.len();
        let frame = Frame::data(stream_id, body).expect("body <= u32::MAX");
        log::trace!("{}: write {} bytes", self, n);

        let cmd = StreamCommand::SendFrame(frame.into());
        self.sender
            .start_send(cmd)
            .map_err(|_| self.write_zero_err())?;
        Poll::Ready(Ok(n))
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context) -> Poll<io::Result<()>> {
        self.sender
            .poll_flush_unpin(cx)
            .map_err(|_| self.write_zero_err())
    }

    fn poll_close(mut self: Pin<&mut Self>, cx: &mut Context) -> Poll<io::Result<()>> {
        if self.is_closed() {
            return Poll::Ready(Ok(()));
        }

        ready!(
            self.sender
                .poll_ready(cx)
                .map_err(|_| self.write_zero_err())?
        );

        log::trace!("{}: close", self);
        let cmd = StreamCommand::CloseStream {
            stream_id: self.stream_id,
        };
        self.sender
            .start_send(cmd)
            .map_err(|_| self.write_zero_err())?;
        self.shared()
            .update_state(self.conn, self.stream_id, State::SendClosed);
        Poll::Ready(Ok(()))
    }
}

#[derive(Debug)]
pub(crate) struct Shared {
    pub(super) state: State,
    flow_controller: FlowController,
    pub(crate) buffer: Chunks,
    pub(crate) reader: Option<Waker>,
    pub(crate) writer: Option<Waker>,
}

impl Shared {
    pub(crate) fn new(
        initial_state: State,
        receive_window: u32,
        send_window: u32,
        accumulated_max_stream_windows: Arc<Mutex<usize>>,
        rtt: Rtt,
        config: Arc<Config>,
    ) -> Self {
        Shared {
            state: initial_state,
            flow_controller: FlowController::new(
                receive_window,
                send_window,
                accumulated_max_stream_windows,
                rtt,
                config,
            ),
            buffer: Chunks::new(),
            reader: None,
            writer: None,
        }
    }

    pub(crate) fn state(&self) -> State {
        self.state
    }

    /// Update the stream state and return the state before it was updated.
    pub(crate) fn update_state(
        &mut self,
        cid: connection::Id,
        sid: StreamId,
        next: State,
    ) -> State {
        use self::State::*;

        let current = self.state;

        match (current, next) {
            (Closed, _) => {}
            (Open, _) => self.state = next,
            (RecvClosed, Closed) => self.state = Closed,
            (RecvClosed, Open) => {}
            (RecvClosed, RecvClosed) => {}
            (RecvClosed, SendClosed) => self.state = Closed,
            (SendClosed, Closed) => self.state = Closed,
            (SendClosed, Open) => {}
            (SendClosed, RecvClosed) => self.state = Closed,
            (SendClosed, SendClosed) => {}
        }

        log::trace!(
            "{}/{}: update state: (from {:?} to {:?} -> {:?})",
            cid,
            sid,
            current,
            next,
            self.state
        );

        current
    }

    pub(crate) fn next_window_update(&mut self) -> Option<u32> {
        self.flow_controller.next_window_update(self.buffer.len())
    }

    pub(crate) fn send_window(&self) -> u32 {
        self.flow_controller.send_window()
    }

    pub(crate) fn consume_send_window(&mut self, i: u32) {
        self.flow_controller.consume_send_window(i)
    }

    pub(crate) fn increase_send_window_by(&mut self, i: u32) {
        self.flow_controller.increase_send_window_by(i)
    }

    pub(crate) fn receive_window(&self) -> u32 {
        self.flow_controller.receive_window()
    }

    pub(crate) fn consume_receive_window(&mut self, i: u32) {
        self.flow_controller.consume_receive_window(i)
    }
}
