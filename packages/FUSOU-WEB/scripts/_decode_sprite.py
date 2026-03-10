"""Decode KanColle TexturePacker msgpack sprite sheet JSON."""
import struct
import json
import sys

path = "C:/Users/ogu-h/Documents/Github/FUSOU/packages/FUSOU-PROXY-DATA/2026-02-13/kcs2/img/common/common_icon_weapon.json"
with open(path, "rb") as f:
    data = f.read()

pos = 0

def read_val():
    global pos
    if pos >= len(data):
        raise ValueError(f"EOF at pos {pos}")
    b = data[pos]
    # fixmap 0x80-0x8f
    if 0x80 <= b <= 0x8F:
        n = b & 0x0F; pos += 1; return _read_map(n)
    # map16
    if b == 0xDE:
        pos += 1; n = struct.unpack_from(">H", data, pos)[0]; pos += 2; return _read_map(n)
    # map32
    if b == 0xDF:
        pos += 1; n = struct.unpack_from(">I", data, pos)[0]; pos += 4; return _read_map(n)
    # fixstr 0xa0-0xbf
    if 0xA0 <= b <= 0xBF:
        n = b & 0x1F; pos += 1; raw = data[pos:pos+n]; pos += n
        return raw.decode("utf-8", errors="replace")
    # str8
    if b == 0xD9:
        pos += 1; n = data[pos]; pos += 1; raw = data[pos:pos+n]; pos += n
        return raw.decode("utf-8", errors="replace")
    # str16
    if b == 0xDA:
        pos += 1; n = struct.unpack_from(">H", data, pos)[0]; pos += 2
        raw = data[pos:pos+n]; pos += n
        return raw.decode("utf-8", errors="replace")
    # str32
    if b == 0xDB:
        pos += 1; n = struct.unpack_from(">I", data, pos)[0]; pos += 4
        raw = data[pos:pos+n]; pos += n
        return raw.decode("utf-8", errors="replace")
    # positive fixint
    if 0x00 <= b <= 0x7F:
        pos += 1; return b
    # negative fixint
    if 0xE0 <= b <= 0xFF:
        pos += 1; return b - 256
    # uint8
    if b == 0xCC: pos += 1; v = data[pos]; pos += 1; return v
    # uint16
    if b == 0xCD: pos += 1; v = struct.unpack_from(">H", data, pos)[0]; pos += 2; return v
    # uint32
    if b == 0xCE: pos += 1; v = struct.unpack_from(">I", data, pos)[0]; pos += 4; return v
    # uint64
    if b == 0xCF: pos += 1; v = struct.unpack_from(">Q", data, pos)[0]; pos += 8; return v
    # int8
    if b == 0xD0: pos += 1; v = struct.unpack_from(">b", data, pos)[0]; pos += 1; return v
    # int16
    if b == 0xD1: pos += 1; v = struct.unpack_from(">h", data, pos)[0]; pos += 2; return v
    # int32
    if b == 0xD2: pos += 1; v = struct.unpack_from(">i", data, pos)[0]; pos += 4; return v
    # int64
    if b == 0xD3: pos += 1; v = struct.unpack_from(">q", data, pos)[0]; pos += 8; return v
    # float32
    if b == 0xCA: pos += 1; v = struct.unpack_from(">f", data, pos)[0]; pos += 4; return v
    # float64
    if b == 0xCB: pos += 1; v = struct.unpack_from(">d", data, pos)[0]; pos += 8; return v
    # fixarray
    if 0x90 <= b <= 0x9F:
        n = b & 0x0F; pos += 1; return [read_val() for _ in range(n)]
    # array16
    if b == 0xDC: pos += 1; n = struct.unpack_from(">H", data, pos)[0]; pos += 2; return [read_val() for _ in range(n)]
    # array32
    if b == 0xDD: pos += 1; n = struct.unpack_from(">I", data, pos)[0]; pos += 4; return [read_val() for _ in range(n)]
    # nil
    if b == 0xC0: pos += 1; return None
    # false
    if b == 0xC2: pos += 1; return False
    # true
    if b == 0xC3: pos += 1; return True
    # bin8
    if b == 0xC4: pos += 1; n = data[pos]; pos += 1; raw = data[pos:pos+n]; pos += n; return f"<bin8:{n}>"
    # bin16
    if b == 0xC5: pos += 1; n = struct.unpack_from(">H", data, pos)[0]; pos += 2; raw = data[pos:pos+n]; pos += n; return f"<bin16:{n}>"
    # bin32
    if b == 0xC6: pos += 1; n = struct.unpack_from(">I", data, pos)[0]; pos += 4; raw = data[pos:pos+n]; pos += n; return f"<bin32:{n}>"
    # fixext1
    if b == 0xD4: pos += 1; t = data[pos]; pos += 1; raw = data[pos:pos+1]; pos += 1; return f"<fixext1:t{t}>"
    # fixext2
    if b == 0xD5: pos += 1; t = data[pos]; pos += 1; raw = data[pos:pos+2]; pos += 2; return f"<fixext2:t{t}>"
    # fixext4
    if b == 0xD6: pos += 1; t = data[pos]; pos += 1; raw = data[pos:pos+4]; pos += 4; return f"<fixext4:t{t}>"
    # fixext8
    if b == 0xD7: pos += 1; t = data[pos]; pos += 1; raw = data[pos:pos+8]; pos += 8; return f"<fixext8:t{t}>"
    # fixext16
    if b == 0xD8: pos += 1; t = data[pos]; pos += 1; raw = data[pos:pos+16]; pos += 16; return f"<fixext16:t{t}>"
    # ext8
    if b == 0xC7: pos += 1; n = data[pos]; pos += 1; t = data[pos]; pos += 1; raw = data[pos:pos+n]; pos += n; return f"<ext8:t{t}:{n}>"
    # ext16
    if b == 0xC8: pos += 1; n = struct.unpack_from(">H", data, pos)[0]; pos += 2; t = data[pos]; pos += 1; raw = data[pos:pos+n]; pos += n; return f"<ext16:t{t}:{n}>"
    # ext32
    if b == 0xC9: pos += 1; n = struct.unpack_from(">I", data, pos)[0]; pos += 4; t = data[pos]; pos += 1; raw = data[pos:pos+n]; pos += n; return f"<ext32:t{t}:{n}>"
    raise ValueError(f"Unknown byte: 0x{b:02X} at pos {pos}, context: {data[max(0,pos-5):pos+10].hex()}")


def _read_map(n):
    pairs = []
    for _ in range(n):
        k = read_val()
        v = read_val()
        # Convert unhashable keys to string
        if isinstance(k, (dict, list)):
            k = json.dumps(k, default=str)
        pairs.append((k, v))
    return dict(pairs)

result = read_val()
print(f"Decoded OK. pos={pos}, total={len(data)}")
print(json.dumps(result, indent=2, default=str))
