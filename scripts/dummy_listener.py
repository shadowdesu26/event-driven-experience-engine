import socket
import sys
import time

port = int(sys.argv[1])
s = socket.socket()
s.bind(("127.0.0.1", port))
s.listen(1)
print(f"listening {port}", flush=True)
time.sleep(600)
