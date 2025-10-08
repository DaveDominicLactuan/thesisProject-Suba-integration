//THIS WON'T BE USED, SINCE THIS IS ANDROID GEARED. THIS IS JUST HISTORY

package io.ionic.starter

import android.content.Context
import org.tensorflow.lite.DataType
import org.tensorflow.lite.support.tensorbuffer.TensorBuffer
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import java.nio.FloatBuffer

class CrackClassifier(context: Context) {

    private val env = OrtEnvironment.getEnvironment()
    private val session: OrtSession

    init {
        // Load the ONNX model from assets
        val modelFile = File(context.filesDir, "crack_multihead_cnn.onnx")
        session = env.createSession(modelFile.absolutePath)
    }

    // Label mappings
    private val typeLabels = arrayOf("branching", "diagonal", "horizontal", "map/web", "vertical")
    private val shapeLabels = arrayOf("branching", "curved", "mapped/network", "straight")
    private val severityLabels = arrayOf("hairline", "minor", "moderate", "severe")

    // Predict function: returns readable labels
    fun predict(inputArray: FloatArray): Map<String, String> {
        val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(inputArray), longArrayOf(1, inputArray.size.toLong()))

        // Run inference
        val results = session.run(mapOf("input" to inputTensor))

        // Assuming results[0] = type logits, results[1] = shape logits, results[2] = severity logits
        val typeIndex = argMax((results[0].value as Array<FloatArray>)[0])
        val shapeIndex = argMax((results[1].value as Array<FloatArray>)[0])
        val severityIndex = argMax((results[2].value as Array<FloatArray>)[0])

        // Map indices to human-readable labels
        return mapOf(
            "type" to typeLabels[typeIndex],
            "shape" to shapeLabels[shapeIndex],
            "severity" to severityLabels[severityIndex]
        )
    }

    // Helper function to get the index of the max value
    private fun argMax(array: FloatArray): Int {
        var maxIndex = 0
        var maxValue = array[0]
        for (i in array.indices) {
            if (array[i] > maxValue) {
                maxValue = array[i]
                maxIndex = i
            }
        }
        return maxIndex
    }
}
