package com.hashimfaisal.torrentiodownloader.download

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.hashimfaisal.torrentiodownloader.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.libtorrent4j.AlertListener
import org.libtorrent4j.SessionManager
import org.libtorrent4j.TorrentHandle
import org.libtorrent4j.alerts.AddTorrentAlert
import org.libtorrent4j.alerts.Alert
import org.libtorrent4j.alerts.AlertType
import org.libtorrent4j.swig.torrent_flags_t
import java.io.File
import java.util.concurrent.atomic.AtomicReference

class TorrentDownloadService : Service() {
    companion object {
        const val ACTION_START = "com.hashimfaisal.torrentiodownloader.START"
        const val EXTRA_MAGNET = "magnet"
        private const val CHANNEL_ID = "torrent_downloads"
        private const val NOTIFICATION_ID = 41
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var session: SessionManager? = null
    private val activeHandle = AtomicReference<TorrentHandle?>(null)

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != ACTION_START) {
            stopSelf(startId)
            return START_NOT_STICKY
        }

        val magnet = intent.getStringExtra(EXTRA_MAGNET)?.trim().orEmpty()
        if (!magnet.startsWith("magnet:?xt=urn:btih:", ignoreCase = true)) {
            stopSelf(startId)
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification("تهيئة محرك التورنت", 0, false))
        scope.launch {
            try {
                if (session == null) {
                    val manager = SessionManager()
                    manager.addListener(object : AlertListener {
                        override fun types(): IntArray = intArrayOf(AlertType.ADD_TORRENT.swig())
                        override fun alert(alert: Alert<*>) {
                            if (alert is AddTorrentAlert) activeHandle.set(alert.handle())
                        }
                    })
                    manager.start()
                    session = manager
                }

                val destination = File(
                    getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir,
                    "Torrentio"
                ).apply { mkdirs() }

                session?.download(magnet, destination, torrent_flags_t())
                monitorDownload()
            } catch (error: Exception) {
                updateNotification("تعذر بدء التنزيل: ${error.message ?: "خطأ غير معروف"}", 0, false)
                delay(5_000)
                stopSelf(startId)
            }
        }
        return START_STICKY
    }

    private suspend fun monitorDownload() {
        while (true) {
            val handle = activeHandle.get()
            if (handle != null && handle.isValid) {
                val status = handle.status()
                val percent = (status.progress() * 100f).toInt().coerceIn(0, 100)
                val speed = status.downloadPayloadRate().toLong()
                val title = status.name().ifBlank { "Torrentio Downloader" }
                updateNotification("$title • ${formatRate(speed)}", percent, true)
                if (status.isSeeding() || status.isFinished()) {
                    updateNotification("اكتمل التنزيل: $title", 100, false)
                    break
                }
            } else {
                updateNotification("جارٍ الاتصال بالمصادر وجلب بيانات التورنت", 0, true)
            }
            delay(1_000)
        }
    }

    private fun formatRate(bytesPerSecond: Long): String {
        val mib = bytesPerSecond / (1024.0 * 1024.0)
        return String.format("%.2f MiB/s", mib)
    }

    private fun buildNotification(text: String, progress: Int, ongoing: Boolean): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Torrentio Downloader")
            .setContentText(text)
            .setProgress(100, progress, false)
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true)
            .build()

    private fun updateNotification(text: String, progress: Int, ongoing: Boolean) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(text, progress, ongoing))
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "تنزيلات Torrentio",
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope.cancel()
        val manager = session
        session = null
        if (manager != null) {
            Thread { runCatching { manager.stop() } }.start()
        }
        super.onDestroy()
    }
}
