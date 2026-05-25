package com.alanbulan.tunefree

import android.Manifest
import android.app.ActivityManager
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.audiofx.Visualizer
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import com.ryanheise.audioservice.AudioServiceActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

class MainActivity : AudioServiceActivity() {
    private var visualizer: Visualizer? = null
    private var pendingAudioSessionId: Int? = null
    private var pendingEventSink: EventChannel.EventSink? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureTaskPreview()
    }

    override fun onResume() {
        super.onResume()
        window.decorView.post { configureTaskPreview() }
        window.decorView.postDelayed({ configureTaskPreview() }, 800L)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            window.decorView.postDelayed({ configureTaskPreview() }, 800L)
        }
    }

    override fun onPause() {
        configureTaskPreview()
        super.onPause()
    }

    private fun configureTaskPreview() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                window.javaClass
                    .getMethod("setRecentsScreenshotEnabled", Boolean::class.javaPrimitiveType)
                    .invoke(window, true)
            } catch (_: Throwable) {
            }
        }
        setTaskDescription(
            ActivityManager.TaskDescription(
                "TuneFree",
                R.mipmap.ic_launcher,
                Color.rgb(246, 247, 251),
            ),
        )
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        EventChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            AUDIO_SPECTRUM_CHANNEL,
        ).setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    val audioSessionId = (arguments as? Number)?.toInt() ?: 0
                    pendingAudioSessionId = audioSessionId
                    pendingEventSink = events
                    startVisualizerWhenAllowed(audioSessionId, events)
                }

                override fun onCancel(arguments: Any?) {
                    stopVisualizer()
                    pendingAudioSessionId = null
                    pendingEventSink = null
                }
            },
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != RECORD_AUDIO_REQUEST_CODE) {
            return
        }

        val audioSessionId = pendingAudioSessionId
        val eventSink = pendingEventSink
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED &&
            audioSessionId != null &&
            eventSink != null
        ) {
            startVisualizer(audioSessionId, eventSink)
        } else {
            eventSink?.error(
                "audio_spectrum_permission_denied",
                "Android audio visualizer permission was denied.",
                null,
            )
        }
    }

    private fun startVisualizerWhenAllowed(
        audioSessionId: Int,
        eventSink: EventChannel.EventSink?,
    ) {
        stopVisualizer()
        if (eventSink == null || audioSessionId <= 0) {
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(
                arrayOf(Manifest.permission.RECORD_AUDIO),
                RECORD_AUDIO_REQUEST_CODE,
            )
            return
        }

        startVisualizer(audioSessionId, eventSink)
    }

    private fun startVisualizer(audioSessionId: Int, eventSink: EventChannel.EventSink) {
        try {
            val nextVisualizer = Visualizer(audioSessionId)
            val captureRange = Visualizer.getCaptureSizeRange()
            nextVisualizer.captureSize = captureRange[1]
            nextVisualizer.scalingMode = Visualizer.SCALING_MODE_NORMALIZED
            nextVisualizer.setDataCaptureListener(
                object : Visualizer.OnDataCaptureListener {
                    override fun onWaveFormDataCapture(
                        visualizer: Visualizer?,
                        waveform: ByteArray?,
                        samplingRate: Int,
                    ) = Unit

                    override fun onFftDataCapture(
                        visualizer: Visualizer?,
                        fft: ByteArray?,
                        samplingRate: Int,
                    ) {
                        if (fft == null) {
                            return
                        }
                        val bars = fftToBars(fft, samplingRate)
                        runOnUiThread { eventSink.success(bars) }
                    }
                },
                Visualizer.getMaxCaptureRate() / 2,
                false,
                true,
            )
            nextVisualizer.enabled = true
            visualizer = nextVisualizer
        } catch (error: Throwable) {
            stopVisualizer()
            eventSink.error(
                "audio_spectrum_unavailable",
                error.message ?: "Android audio visualizer is unavailable.",
                null,
            )
        }
    }

    private fun stopVisualizer() {
        val previousVisualizer = visualizer ?: return
        try {
            previousVisualizer.enabled = false
        } catch (_: Throwable) {
        }
        previousVisualizer.release()
        visualizer = null
    }

    private fun fftToBars(fft: ByteArray, samplingRateMilliHz: Int): List<Double> {
        val binCount = fft.size / 2
        if (binCount < 2) {
            return List(BAR_COUNT) { 0.0 }
        }

        val magnitudes = DoubleArray(binCount)
        magnitudes[0] = kotlin.math.abs(fft[0].toInt()).toDouble()
        for (bin in 1 until binCount) {
            val real = fft[bin * 2].toInt()
            val imaginary = fft[bin * 2 + 1].toInt()
            magnitudes[bin] = sqrt((real * real + imaginary * imaginary).toDouble())
        }

        val maxBin = binCount - 1
        val minBin = minRenderedBin(samplingRateMilliHz, fft.size, maxBin)
        val rawBars = DoubleArray(BAR_COUNT)
        for (barIndex in 0 until BAR_COUNT) {
            val startRatio = barIndex.toDouble() / BAR_COUNT
            val endRatio = (barIndex + 1).toDouble() / BAR_COUNT
            val startBin = fftBinForRatio(startRatio, minBin, maxBin)
            val endBin = max(startBin + 1, fftBinForRatio(endRatio, minBin, maxBin))
                .coerceAtMost(binCount)

            var squareSum = 0.0
            var peak = 0.0
            for (bin in startBin until endBin) {
                val magnitude = magnitudes[bin]
                squareSum += magnitude * magnitude
                peak = max(peak, magnitude)
            }
            val rms = sqrt(squareSum / (endBin - startBin))
            val frequencyGain = 1.0 + barIndex.toDouble() / (BAR_COUNT - 1) * HIGH_FREQUENCY_GAIN
            val lowBandGain = LOW_FREQUENCY_GAIN_BASE +
                (1.0 - LOW_FREQUENCY_GAIN_BASE) *
                min(1.0, barIndex.toDouble() / LOW_FREQUENCY_RECOVERY_BARS)
            rawBars[barIndex] = (rms * 0.72 + peak * 0.28) * frequencyGain * lowBandGain
        }

        val spreadBars = DoubleArray(BAR_COUNT)
        for (barIndex in 0 until BAR_COUNT) {
            val previous = rawBars.getOrElse(barIndex - 1) { 0.0 }
            val next = rawBars.getOrElse(barIndex + 1) { 0.0 }
            spreadBars[barIndex] = rawBars[barIndex] * 0.68 + previous * 0.18 + next * 0.14
        }
        limitFirstBarOutlier(spreadBars)

        val framePeak = spreadBars.maxOrNull() ?: 0.0
        if (framePeak <= MIN_FRAME_PEAK) {
            return List(BAR_COUNT) { 0.0 }
        }

        val noiseFloor = framePeak * NOISE_FLOOR_RATIO
        return spreadBars.map { value ->
            ((value - noiseFloor).coerceAtLeast(0.0) / (framePeak - noiseFloor))
                .coerceIn(0.0, 1.0)
                .pow(RESPONSE_CURVE)
        }
    }

    private fun minRenderedBin(
        samplingRateMilliHz: Int,
        fftSize: Int,
        maxBin: Int,
    ): Int {
        val samplingRateHz = samplingRateMilliHz / 1000.0
        if (samplingRateHz <= 0.0) {
            return FALLBACK_MIN_RENDERED_BIN.coerceIn(1, maxBin)
        }
        return ceil(MIN_RENDERED_FREQUENCY_HZ * fftSize / samplingRateHz)
            .toInt()
            .coerceIn(1, maxBin)
    }

    private fun fftBinForRatio(ratio: Double, minBin: Int, maxBin: Int): Int {
        return (minBin + floor(ratio.pow(FREQUENCY_DISTRIBUTION_CURVE) * (maxBin - minBin)))
            .toInt()
            .coerceIn(minBin, maxBin)
    }

    private fun limitFirstBarOutlier(spreadBars: DoubleArray) {
        val neighborCount = min(FIRST_BAR_NEIGHBOR_COUNT, spreadBars.size - 1)
        if (neighborCount <= 0) {
            return
        }

        var neighborSum = 0.0
        for (index in 1..neighborCount) {
            neighborSum += spreadBars[index]
        }
        val neighborAverage = neighborSum / neighborCount
        if (neighborAverage > 0.0) {
            spreadBars[0] = min(spreadBars[0], neighborAverage * FIRST_BAR_NEIGHBOR_LIMIT)
        }
    }

    companion object {
        private const val AUDIO_SPECTRUM_CHANNEL = "tunefree/audio_spectrum"
        private const val RECORD_AUDIO_REQUEST_CODE = 9321
        private const val BAR_COUNT = 48
        private const val FREQUENCY_DISTRIBUTION_CURVE = 0.82
        private const val HIGH_FREQUENCY_GAIN = 3.2
        private const val LOW_FREQUENCY_GAIN_BASE = 0.42
        private const val LOW_FREQUENCY_RECOVERY_BARS = 7.0
        private const val MIN_RENDERED_FREQUENCY_HZ = 120.0
        private const val FALLBACK_MIN_RENDERED_BIN = 3
        private const val FIRST_BAR_NEIGHBOR_COUNT = 6
        private const val FIRST_BAR_NEIGHBOR_LIMIT = 1.28
        private const val RESPONSE_CURVE = 0.62
        private const val NOISE_FLOOR_RATIO = 0.04
        private const val MIN_FRAME_PEAK = 1.0
    }
}
