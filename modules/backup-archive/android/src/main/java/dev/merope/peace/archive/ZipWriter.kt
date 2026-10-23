package dev.merope.peace.archive

import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * One entry of a zip: a file on disk, or a short text.
 *
 * The LAYOUT of a backup (entry names, what is compressed, the manifest) is
 * decided in `src/lib/container.ts`, never here. This writes whatever list it
 * is handed, so there is still one definition of the format.
 */
data class ZipSource(val name: String, val file: File?, val text: String?, val deflate: Boolean)

/**
 * Streams a zip straight from disk to disk.
 *
 * Plain JVM code with no Android imports, so it can be checked against fflate
 * on a desktop, where the container format is tested.
 */
object ZipWriter {
  private const val BUFFER = 64 * 1024

  /** Writes `sources` to `destination` in order and returns the file's size. */
  fun write(destination: File, sources: List<ZipSource>, modifiedAt: Long): Long {
    ZipOutputStream(BufferedOutputStream(FileOutputStream(destination), BUFFER)).use { zip ->
      zip.setLevel(6)
      val buffer = ByteArray(BUFFER)

      for (source in sources) {
        val entry = ZipEntry(source.name)
        entry.time = modifiedAt
        val text = source.text?.toByteArray(Charsets.UTF_8)
        val file = source.file

        if (source.deflate) {
          entry.method = ZipEntry.DEFLATED
        } else {
          // STORED needs its size and CRC in the local header, before the bytes.
          // A JPEG is already compressed, so reading it twice costs far less than
          // deflating it for nothing.
          val crc = CRC32()
          val size: Long
          if (text != null) {
            crc.update(text)
            size = text.size.toLong()
          } else {
            size = checksum(requireNotNull(file) { "Entry ${source.name} has no content" }, crc, buffer)
          }
          entry.method = ZipEntry.STORED
          entry.size = size
          entry.compressedSize = size
          entry.crc = crc.value
        }

        zip.putNextEntry(entry)
        if (text != null) {
          zip.write(text)
        } else {
          FileInputStream(requireNotNull(file) { "Entry ${source.name} has no content" }).use { input ->
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              zip.write(buffer, 0, read)
            }
          }
        }
        zip.closeEntry()
      }
    }
    return destination.length()
  }

  private fun checksum(file: File, crc: CRC32, buffer: ByteArray): Long {
    var size = 0L
    FileInputStream(file).use { input ->
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        crc.update(buffer, 0, read)
        size += read
      }
    }
    return size
  }
}
