package io.github.jubasse.seampact.maven

import org.codehaus.plexus.configuration.PlexusConfiguration
import org.codehaus.plexus.configuration.xml.XmlPlexusConfiguration
import org.codehaus.plexus.util.xml.Xpp3DomBuilder
import java.io.StringReader

/** A `<configuration>` element as Maven hands it to a mojo, from its XML. */
internal fun plexusConfiguration(xml: String): PlexusConfiguration = XmlPlexusConfiguration(Xpp3DomBuilder.build(StringReader(xml.trim())))
