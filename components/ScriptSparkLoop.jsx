import Script from "next/script";
import { getScriptUrl } from "@/lib/sparkloop-embed";

// SparkLoop's script, which opens the signup flow. FormSubscribe tells it about each signup.
export default function ScriptSparkLoop({ publicationUuid }) {
	return <Script src={getScriptUrl(publicationUuid)} strategy="afterInteractive" data-sparkloop="" />;
}
