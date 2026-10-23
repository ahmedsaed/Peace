package dev.merope.peace.archive

import android.net.Uri
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ZipEntrySpec : Record {
  @Field val name: String = ""
  /** A `file://` uri or a bare path. */
  @Field val path: String? = null
  @Field val text: String? = null
  @Field val deflate: Boolean = false
}

/**
 * The CPU-heavy half of a backup, off the JS thread.
 *
 * Packing the ledger and its receipts into a zip and deriving a sealing key
 * used to run in Hermes. However it was sliced, that held the one thread
 * that draws the screen and answers taps, and a backup due at launch made
 * the app crawl for minutes. Both now run on background dispatchers, and the
 * JS side only waits on a promise.
 *
 * `Coroutine` + `withContext` rather than a plain AsyncFunction: a plain one
 * runs on the single queue that every Expo module shares, so a long zip there
 * would stall file reads, crypto and notifications behind it.
 */
class BackupArchiveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BackupArchive")

    AsyncFunction("zip") Coroutine { destination: String, entries: List<ZipEntrySpec>, modifiedAt: Double ->
      withContext(Dispatchers.IO) {
        val sources = entries.map { entry ->
          ZipSource(entry.name, entry.path?.let(::fileOf), entry.text, entry.deflate)
        }
        ZipWriter.write(fileOf(destination), sources, modifiedAt.toLong()).toDouble()
      }
    }

    AsyncFunction("scrypt") Coroutine { password: ByteArray, salt: ByteArray, logN: Int, r: Int, p: Int, dkLen: Int ->
      withContext(Dispatchers.Default) {
        Scrypt.derive(password, salt, 1 shl logN, r, p, dkLen)
      }
    }
  }

  private fun fileOf(uriOrPath: String): File =
    File(if (uriOrPath.startsWith("file:")) requireNotNull(Uri.parse(uriOrPath).path) else uriOrPath)
}
