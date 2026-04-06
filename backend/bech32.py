"""
Pure Python bech32/bech32m encoder for Bitcoin addresses.
No dependencies. Supports P2WPKH (bc1q) and P2TR (bc1p).
"""

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

def _bech32_polymod(values):
    GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = (chk & 0x1ffffff) << 5 ^ v
        for i in range(5):
            chk ^= GEN[i] if ((b >> i) & 1) else 0
    return chk

def _bech32_hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]

def _convertbits(data, frombits, tobits, pad=True):
    acc = 0; bits = 0; ret = []; maxv = (1 << tobits) - 1
    for value in data:
        acc = ((acc << frombits) | value) & 0xffffffff
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad:
        if bits:
            ret.append((acc << (tobits - bits)) & maxv)
    elif bits >= frombits or ((acc << (tobits - bits)) & maxv):
        return None
    return ret

def _bech32_encode(hrp, witver, witprog, spec):
    """Encode a segwit address."""
    data = [witver] + _convertbits(witprog, 8, 5)
    const = 0x2bc830a3 if spec == 'bech32m' else 1
    values = _bech32_hrp_expand(hrp) + data
    polymod = _bech32_polymod(values + [0, 0, 0, 0, 0, 0]) ^ const
    checksum = [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]
    return hrp + '1' + ''.join([CHARSET[d] for d in data + checksum])

def hash160_to_p2wpkh(hash160_hex: str, hrp: str = 'bc') -> str:
    """Convert a 20-byte hash160 (hex) to a P2WPKH bech32 address (bc1q...)."""
    try:
        prog = bytes.fromhex(hash160_hex)
        if len(prog) != 20:
            return f"(invalid hash160 length {len(prog)})"
        return _bech32_encode(hrp, 0, prog, 'bech32')
    except Exception as e:
        return f"(decode error: {e})"

def hash256_to_p2wsh(hash256_hex: str, hrp: str = 'bc') -> str:
    """Convert a 32-byte hash (hex) to a P2WSH bech32 address."""
    try:
        prog = bytes.fromhex(hash256_hex)
        if len(prog) != 32:
            return f"(invalid hash256 length {len(prog)})"
        return _bech32_encode(hrp, 0, prog, 'bech32')
    except Exception as e:
        return f"(decode error: {e})"

def hash256_to_p2tr(hash256_hex: str, hrp: str = 'bc') -> str:
    """Convert a 32-byte x-only pubkey (hex) to a P2TR bech32m address (bc1p...)."""
    try:
        prog = bytes.fromhex(hash256_hex)
        if len(prog) != 32:
            return f"(invalid pubkey length {len(prog)})"
        return _bech32_encode(hrp, 1, prog, 'bech32m')
    except Exception as e:
        return f"(decode error: {e})"
