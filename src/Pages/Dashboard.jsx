
import NetworkDevices from "./NetworkDevices";

export default function Dashboard() {
  return (
    <NetworkDevices
      title="IP Network Dashboard"
      showActions={true}
      allowAdd={true}
      allowEdit={true}
      allowDelete={true}
    />
  );
}
