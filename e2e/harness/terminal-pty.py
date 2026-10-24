"""Run one isolated TUI command with a real PTY; relay bytes without delays."""
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

pid, master = pty.fork()
if pid == 0:
    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)

fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 180, 0, 0))

def stop(signum, frame):
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stop)
try:
    while True:
        readable, _, _ = select.select([master, sys.stdin.buffer], [], [])
        for source in readable:
            if source == master:
                try:
                    data = os.read(master, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    data = b""
                if not data:
                    _, status = os.waitpid(pid, 0)
                    pid = 0
                    raise SystemExit(os.waitstatus_to_exitcode(status))
                os.write(sys.stdout.fileno(), data)
            else:
                data = os.read(sys.stdin.fileno(), 65536)
                if not data:
                    raise SystemExit(0)
                os.write(master, data)
finally:
    os.close(master)
    if pid:
        os.killpg(pid, signal.SIGTERM)
        os.waitpid(pid, 0)
