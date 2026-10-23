package dev.merope.peace.archive

import java.security.MessageDigest

/**
 * scrypt (RFC 7914), so deriving a backup's key never runs on the JS thread.
 *
 * In Hermes, which has no JIT, N=2^14 r=8 held the thread for seconds, and
 * noble's "async" variant yields to microtasks only, so a tap still could not
 * land. Here it takes tens of milliseconds on a background thread.
 *
 * Plain Kotlin with no Android imports, so it can be checked on a JVM against
 * the RFC's vectors and against noble byte for byte. Android ships no public
 * scrypt, and Bouncy Castle would add megabytes for one function. The result
 * must match noble exactly: backups sealed by older builds are opened with it.
 */
object Scrypt {
  fun derive(password: ByteArray, salt: ByteArray, n: Int, r: Int, p: Int, dkLen: Int): ByteArray {
    require(n > 1 && n and (n - 1) == 0) { "N must be a power of two above 1" }
    require(r > 0 && p > 0 && dkLen > 0) { "r, p and dkLen must be positive" }

    val blockBytes = 128 * r
    val b = pbkdf2(password, salt, p * blockBytes)
    val words = 32 * r
    val x = IntArray(words)
    val y = IntArray(words)
    val v = IntArray(words * n)

    for (chunk in 0 until p) {
      val offset = chunk * blockBytes
      for (i in 0 until words) x[i] = readLe(b, offset + i * 4)

      for (i in 0 until n) {
        System.arraycopy(x, 0, v, i * words, words)
        blockMix(x, y, r)
        System.arraycopy(y, 0, x, 0, words)
      }
      for (i in 0 until n) {
        // Integerify: the first word of the last 64-byte block. N fits in an
        // Int, so its low 32 bits are all the index needs.
        val j = x[(2 * r - 1) * 16] and (n - 1)
        val base = j * words
        for (k in 0 until words) x[k] = x[k] xor v[base + k]
        blockMix(x, y, r)
        System.arraycopy(y, 0, x, 0, words)
      }

      for (i in 0 until words) writeLe(b, offset + i * 4, x[i])
    }
    return pbkdf2(password, b, dkLen)
  }

  /** BlockMix with Salsa20/8: even blocks to the front half, odd to the back. */
  private fun blockMix(input: IntArray, output: IntArray, r: Int) {
    val t = IntArray(16)
    System.arraycopy(input, (2 * r - 1) * 16, t, 0, 16)
    for (i in 0 until 2 * r) {
      for (k in 0 until 16) t[k] = t[k] xor input[i * 16 + k]
      salsa8(t)
      val at = if (i % 2 == 0) (i / 2) * 16 else (r + i / 2) * 16
      System.arraycopy(t, 0, output, at, 16)
    }
  }

  private fun salsa8(b: IntArray) {
    val x = b.copyOf()
    repeat(4) {
      x[4] = x[4] xor Integer.rotateLeft(x[0] + x[12], 7)
      x[8] = x[8] xor Integer.rotateLeft(x[4] + x[0], 9)
      x[12] = x[12] xor Integer.rotateLeft(x[8] + x[4], 13)
      x[0] = x[0] xor Integer.rotateLeft(x[12] + x[8], 18)
      x[9] = x[9] xor Integer.rotateLeft(x[5] + x[1], 7)
      x[13] = x[13] xor Integer.rotateLeft(x[9] + x[5], 9)
      x[1] = x[1] xor Integer.rotateLeft(x[13] + x[9], 13)
      x[5] = x[5] xor Integer.rotateLeft(x[1] + x[13], 18)
      x[14] = x[14] xor Integer.rotateLeft(x[10] + x[6], 7)
      x[2] = x[2] xor Integer.rotateLeft(x[14] + x[10], 9)
      x[6] = x[6] xor Integer.rotateLeft(x[2] + x[14], 13)
      x[10] = x[10] xor Integer.rotateLeft(x[6] + x[2], 18)
      x[3] = x[3] xor Integer.rotateLeft(x[15] + x[11], 7)
      x[7] = x[7] xor Integer.rotateLeft(x[3] + x[15], 9)
      x[11] = x[11] xor Integer.rotateLeft(x[7] + x[3], 13)
      x[15] = x[15] xor Integer.rotateLeft(x[11] + x[7], 18)
      x[1] = x[1] xor Integer.rotateLeft(x[0] + x[3], 7)
      x[2] = x[2] xor Integer.rotateLeft(x[1] + x[0], 9)
      x[3] = x[3] xor Integer.rotateLeft(x[2] + x[1], 13)
      x[0] = x[0] xor Integer.rotateLeft(x[3] + x[2], 18)
      x[6] = x[6] xor Integer.rotateLeft(x[5] + x[4], 7)
      x[7] = x[7] xor Integer.rotateLeft(x[6] + x[5], 9)
      x[4] = x[4] xor Integer.rotateLeft(x[7] + x[6], 13)
      x[5] = x[5] xor Integer.rotateLeft(x[4] + x[7], 18)
      x[11] = x[11] xor Integer.rotateLeft(x[10] + x[9], 7)
      x[8] = x[8] xor Integer.rotateLeft(x[11] + x[10], 9)
      x[9] = x[9] xor Integer.rotateLeft(x[8] + x[11], 13)
      x[10] = x[10] xor Integer.rotateLeft(x[9] + x[8], 18)
      x[12] = x[12] xor Integer.rotateLeft(x[15] + x[14], 7)
      x[13] = x[13] xor Integer.rotateLeft(x[12] + x[15], 9)
      x[14] = x[14] xor Integer.rotateLeft(x[13] + x[12], 13)
      x[15] = x[15] xor Integer.rotateLeft(x[14] + x[13], 18)
    }
    for (i in 0 until 16) b[i] += x[i]
  }

  /**
   * PBKDF2-HMAC-SHA256 with one iteration, which is all scrypt asks of it.
   *
   * HMAC is written out rather than taken from `javax.crypto.Mac` because
   * `SecretKeySpec` refuses an empty key, and the RFC's first vector has one.
   */
  private fun pbkdf2(password: ByteArray, salt: ByteArray, length: Int): ByteArray {
    val key = if (password.size > 64) sha256(password) else password
    val ipad = ByteArray(64) { i -> ((if (i < key.size) key[i].toInt() else 0) xor 0x36).toByte() }
    val opad = ByteArray(64) { i -> ((if (i < key.size) key[i].toInt() else 0) xor 0x5c).toByte() }

    val out = ByteArray(length)
    var block = 1
    var at = 0
    while (at < length) {
      val inner = MessageDigest.getInstance("SHA-256")
      inner.update(ipad)
      inner.update(salt)
      inner.update(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
      val outer = MessageDigest.getInstance("SHA-256")
      outer.update(opad)
      val t = outer.digest(inner.digest())
      val take = minOf(t.size, length - at)
      System.arraycopy(t, 0, out, at, take)
      at += take
      block += 1
    }
    return out
  }

  private fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

  private fun readLe(b: ByteArray, at: Int): Int =
    (b[at].toInt() and 0xff) or
      ((b[at + 1].toInt() and 0xff) shl 8) or
      ((b[at + 2].toInt() and 0xff) shl 16) or
      ((b[at + 3].toInt() and 0xff) shl 24)

  private fun writeLe(b: ByteArray, at: Int, value: Int) {
    b[at] = value.toByte()
    b[at + 1] = (value ushr 8).toByte()
    b[at + 2] = (value ushr 16).toByte()
    b[at + 3] = (value ushr 24).toByte()
  }
}
