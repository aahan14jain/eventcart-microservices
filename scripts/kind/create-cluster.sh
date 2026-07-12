#!/usr/bin/env bash
# Create a Kind cluster with NGINX Ingress Controller for EventCart.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-eventcart}"

echo "==> Creating Kind cluster '${CLUSTER_NAME}'..."
kind create cluster \
  --name "${CLUSTER_NAME}" \
  --config "${REPO_ROOT}/k8s/kind/cluster-config.yaml" \
  --wait 120s

echo "==> Installing NGINX Ingress Controller..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.3/deploy/static/provider/kind/deploy.yaml

echo "==> Waiting for ingress-nginx controller..."
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=180s

echo "==> Adding /etc/hosts entries (requires sudo)..."
HOSTS_ENTRIES=(
  "127.0.0.1 api.eventcart.local"
  "127.0.0.1 grafana.eventcart.local"
  "127.0.0.1 prometheus.eventcart.local"
  "127.0.0.1 kafka-ui.eventcart.local"
  "127.0.0.1 ops.eventcart.local"
)

for entry in "${HOSTS_ENTRIES[@]}"; do
  if ! grep -qF "${entry}" /etc/hosts 2>/dev/null; then
    echo "${entry}" | sudo tee -a /etc/hosts > /dev/null
  fi
done

echo "==> Kind cluster '${CLUSTER_NAME}' is ready."
kubectl cluster-info --context "kind-${CLUSTER_NAME}"
