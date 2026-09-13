function loadRemote(id: string) {
  return id;
}

const loadShare = (id: string) => id;

loadRemote("not-a-remote");
loadShare("not-a-shared-package");
