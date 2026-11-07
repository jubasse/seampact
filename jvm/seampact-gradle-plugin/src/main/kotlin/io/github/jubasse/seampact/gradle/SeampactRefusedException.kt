package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.runner.problemsText
import org.gradle.api.GradleException

/** A run that refused: every problem, named, so one build shows them all. */
internal class SeampactRefusedException(problems: List<ConfigProblem>) :
    GradleException("seampact refused the app config:\n" + problemsText(problems))
