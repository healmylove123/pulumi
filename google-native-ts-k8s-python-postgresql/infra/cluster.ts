import * as gcloud from "@pulumi/google-native";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as config from "./config";
import { db } from "./db";

const cluster = new gcloud.container.v1.Cluster("cluster", {
  location: config.region,
  autopilot: { enabled: true},
  project: config.project,
  releaseChannel: { "channel": gcloud.container.v1.ReleaseChannelChannel.Regular },
  nodePools: [
    {
      name: "initial",
      config: {
        oauthScopes: [
          "https://www.googleapis.com/auth/devstorage.read_only",
          "https://www.googleapis.com/auth/logging.write",
          "https://www.googleapis.com/auth/monitoring",
          "https://www.googleapis.com/auth/service.management.readonly",
          "https://www.googleapis.com/auth/servicecontrol",
          "https://www.googleapis.com/auth/trace.append",
          "https://www.googleapis.com/auth/compute",
        ],
      },
    }
  ],
  workloadIdentityConfig: {
    workloadPool: `${config.project}.svc.id.goog`,
},
}, { dependsOn: [db] });

// Manufacture a GKE-style Kubeconfig. Note that this is slightly "different" because of the way GKE requires
// gcloud to be in the picture for cluster authentication (rather than using the client cert/key directly).
export const kubeConfig = pulumi.
  all([cluster.name, cluster.endpoint, cluster.location, cluster.masterAuth]).
  apply(([name, endpoint, location, auth]) => {
    const context = `${config.project}_${location}_${name}`;
    return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${auth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp
`;
  });

// Export a Kubernetes provider instance that uses our cluster from above.
export const provider = new k8s.Provider("gke-k8s", {
  kubeconfig: kubeConfig,
}, {
  dependsOn: [cluster],
});
