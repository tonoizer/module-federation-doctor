/** Fixture: createScript and createLink keep CORS attributes aligned. */
export default function validCorsPlugin() {
  return {
    name: "valid-cors",
    createScript({ url }: { url: string }) {
      const script = document.createElement("script");
      script.src = url;
      script.crossOrigin = "anonymous";
      return script;
    },
    createLink({ url }: { url: string }) {
      const link = document.createElement("link");
      link.setAttribute("href", url);
      link.setAttribute("crossorigin", "anonymous");
      return link;
    },
  };
}
