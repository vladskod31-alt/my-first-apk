package app.libo.android.ui

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

class VoiceNoteRecorder(context: Context) {
    private val appContext = context.applicationContext
    private val directory = File(appContext.filesDir, "voice-notes").apply { mkdirs() }
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null

    fun start(): File {
        stopAndDiscard()
        val target = File(directory, "voice-${System.currentTimeMillis()}.m4a")
        val instance = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(appContext)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        try {
            instance.setAudioSource(MediaRecorder.AudioSource.MIC)
            instance.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            instance.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            instance.setAudioEncodingBitRate(96_000)
            instance.setAudioSamplingRate(44_100)
            instance.setOutputFile(target.absolutePath)
            instance.prepare()
            instance.start()
            recorder = instance
            outputFile = target
            return target
        } catch (error: Exception) {
            runCatching { instance.release() }
            target.delete()
            throw error
        }
    }

    fun stop(): File? {
        val current = recorder ?: return null
        val file = outputFile
        recorder = null
        outputFile = null
        return try {
            current.stop()
            file?.takeIf { it.exists() && it.length() > 512 }
        } catch (_: Exception) {
            file?.delete()
            null
        } finally {
            runCatching { current.reset() }
            runCatching { current.release() }
        }
    }

    fun stopAndDiscard() {
        val current = recorder
        val file = outputFile
        recorder = null
        outputFile = null
        if (current != null) {
            runCatching { current.stop() }
            runCatching { current.reset() }
            runCatching { current.release() }
        }
        file?.delete()
    }
}
