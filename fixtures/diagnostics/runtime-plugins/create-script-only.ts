/** Fixture: createScript sets CORS without matching createLink. */
export default function corsScriptOnlyPlugin() {
  return {
    name: "cors-script-only",
    createScript({ url }: { url: string }) {
      const script = document.createElement("script");
      script.src = url;
      script.crossOrigin = "anonymous";
      return script;
    },
  };
}
