import {
  loadRemote as importedLoadRemote,
  loadShare as importedLoadShare,
} from "@module-federation/runtime";

export function useImportedApis() {
  importedLoadRemote("shop/App");
  importedLoadShare("react");
}

export function useShadowedParameters(
  loadRemote: (id: string) => unknown,
  loadShare: (id: string) => unknown,
) {
  loadRemote("local/remote");
  loadShare("local-share");
}

export function useShadowedDeclarations() {
  function loadRemote(id: string) {
    return id;
  }

  loadRemote("local/function");

  {
    const loadShare = (id: string) => id;
    loadShare("local/block");
  }
}
