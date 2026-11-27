package com.hashimfaisal.torrentiodownloader

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.hashimfaisal.torrentiodownloader.download.TorrentDownloadService

class MainActivity : ComponentActivity() {
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermissionIfNeeded()

        setContent {
            var magnet by remember { mutableStateOf("") }
            var message by remember { mutableStateOf("ألصق رابط Magnet لبدء التنزيل") }

            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(24.dp),
                        verticalArrangement = Arrangement.Center
                    ) {
                        Text("Torrentio Downloader", style = MaterialTheme.typography.headlineMedium)
                        Spacer(Modifier.height(8.dp))
                        Text("مدير تنزيل BitTorrent مستقل للأندرويد")
                        Spacer(Modifier.height(24.dp))
                        OutlinedTextField(
                            value = magnet,
                            onValueChange = { magnet = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Magnet link") },
                            placeholder = { Text("magnet:?xt=urn:btih:...") },
                            minLines = 3
                        )
                        Spacer(Modifier.height(16.dp))
                        Button(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                val normalized = magnet.trim()
                                if (!normalized.startsWith("magnet:?xt=urn:btih:", ignoreCase = true)) {
                                    message = "الرابط غير صالح. أدخل Magnet يحتوي على info hash."
                                } else {
                                    val intent = Intent(this@MainActivity, TorrentDownloadService::class.java)
                                        .setAction(TorrentDownloadService.ACTION_START)
                                        .putExtra(TorrentDownloadService.EXTRA_MAGNET, normalized)
                                    ContextCompat.startForegroundService(this@MainActivity, intent)
                                    message = "تم إرسال طلب التنزيل إلى الخدمة."
                                }
                            }
                        ) {
                            Text("ابدأ التنزيل")
                        }
                        Spacer(Modifier.height(16.dp))
                        Text(message, style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.height(24.dp))
                        Text(
                            "يُحفظ الإصدار الأول داخل مجلد التطبيق الخاص. اختيار مجلد عام في Downloads وتصدير الملف بعد اكتماله قيد التطوير.",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
