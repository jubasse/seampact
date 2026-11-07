package io.github.jubasse.seampact.springboot.runtime;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.lang.reflect.Proxy;
import java.util.Collections;

/** Servlet stand-ins for the boundary steps run outside a server. */
final class TestServletProxies {
    private TestServletProxies() {}

    /** A response no step writes to: any call fails the test. */
    static HttpServletResponse unusedResponse() {
        return HttpServletResponse.class.cast(Proxy.newProxyInstance(TestServletProxies.class.getClassLoader(),
                new Class<?>[] {HttpServletResponse.class}, (proxy, method, arguments) -> {
                    throw new UnsupportedOperationException("the step under test writes no response: " + method.getName());
                }));
    }

    /** A `GET` request without headers carrying [rawQuery] as sent. */
    static HttpServletRequest getRequest(String rawQuery) {
        return HttpServletRequest.class.cast(Proxy.newProxyInstance(TestServletProxies.class.getClassLoader(),
                new Class<?>[] {HttpServletRequest.class}, (proxy, method, arguments) -> switch (method.getName()) {
                    case "getMethod" -> "GET";
                    case "getQueryString" -> rawQuery;
                    case "getHeaderNames", "getHeaders" -> Collections.emptyEnumeration();
                    case "getRemoteAddr" -> null;
                    default -> throw new UnsupportedOperationException("the step under test reads no " + method.getName());
                }));
    }
}
