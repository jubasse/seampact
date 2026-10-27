package io.github.jubasse.seampact.springboot

import io.github.jubasse.seampact.springboot.runtime.SeampactRuntimeVersion
import kotlin.test.Test
import kotlin.test.assertEquals

/** The generator and the runtime of one build are released at one version (ADR 0025, G1). */
class TargetVersionTest {
    @Test
    fun `the target stamps the version of the runtime built beside it`() {
        assertEquals(SeampactRuntimeVersion.VERSION, SpringBootTarget.VERSION)
    }
}
