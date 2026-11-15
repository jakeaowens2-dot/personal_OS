import { redirect } from "next/navigation";

export default function LocalTaskTrackerPreviewPage() {
  redirect("/projects/safety-evidence?preview=1");
}
