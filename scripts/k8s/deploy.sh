#!/usr/bin/env bash
# Build container images, load into Kind, and deploy EventCart to Kubernetes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CLUSTER_NAME="${CLUSTER_NAME:-eventcart}"
K8S_CONTEXT="kind-${CLUSTER_NAME}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

SERVICES=(
  order-service
  inventory-service
  payment-service
  notification-service
)

log() { echo "==> $*"; }

SKIP_BUILD="${SKIP_BUILD:-false}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1"; exit 1; }
}

require_cmd docker
require_cmd kubectl
require_cmd kind
require_cmd helm

# Ensure cluster exists
if ! kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
  log "Kind cluster not found — creating..."
  bash "${REPO_ROOT}/scripts/kind/create-cluster.sh"
fi

kubectl config use-context "${K8S_CONTEXT}"

log "Building microservice images..."
if [[ "${SKIP_BUILD}" != "true" ]]; then
  for svc in "${SERVICES[@]}"; do
    image="eventcart/${svc}:${IMAGE_TAG}"
    log "Building ${image}"
    docker build \
      -t "${image}" \
      "${REPO_ROOT}/EventCart/services/${svc}"
    kind load docker-image "${image}" --name "${CLUSTER_NAME}"
  done
else
  log "SKIP_BUILD=true — using pre-loaded images"
fi

log "Applying namespace and governance objects..."
kubectl apply -f "${REPO_ROOT}/k8s/namespace/"

log "Deploying data layer (PostgreSQL, Redis)..."
kubectl apply -f "${REPO_ROOT}/k8s/postgres/"
kubectl apply -f "${REPO_ROOT}/k8s/redis/"

log "Waiting for PostgreSQL..."
kubectl wait --namespace eventcart \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/name=postgres \
  --timeout=300s

log "Waiting for Redis..."
kubectl wait --namespace eventcart \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/name=redis \
  --timeout=180s

log "Installing Kafka via Bitnami Helm chart..."
helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
helm repo update
helm upgrade --install eventcart bitnami/kafka \
  --namespace eventcart \
  --create-namespace \
  -f "${REPO_ROOT}/k8s/kafka/helm-values.yaml" \
  --wait \
  --timeout 10m

log "Provisioning Kafka topics..."
kubectl delete job kafka-topics-init -n eventcart --ignore-not-found
kubectl apply -f "${REPO_ROOT}/k8s/kafka/kafka-topics-job.yaml"
kubectl wait --namespace eventcart \
  --for=condition=complete job/kafka-topics-init \
  --timeout=300s

log "Deploying Kafka UI..."
kubectl apply -f "${REPO_ROOT}/k8s/kafka/kafka-ui.yaml"

log "Deploying monitoring stack..."
kubectl apply -f "${REPO_ROOT}/k8s/monitoring/"

log "Deploying microservices..."
kubectl apply -f "${REPO_ROOT}/k8s/order-service/"
kubectl apply -f "${REPO_ROOT}/k8s/inventory-service/"
kubectl apply -f "${REPO_ROOT}/k8s/payment-service/"
kubectl apply -f "${REPO_ROOT}/k8s/notification-service/"

if [[ "${IMAGE_TAG}" != "latest" ]]; then
  log "Setting image tag to ${IMAGE_TAG}..."
  for svc in "${SERVICES[@]}"; do
    kubectl set image "deployment/${svc}" \
      "${svc}=eventcart/${svc}:${IMAGE_TAG}" \
      -n eventcart
  done
fi

log "Waiting for microservice rollouts..."
for svc in "${SERVICES[@]}"; do
  kubectl rollout status deployment/"${svc}" -n eventcart --timeout=300s
done

log "Applying HorizontalPodAutoscalers..."
kubectl apply -f "${REPO_ROOT}/k8s/hpa/"

log "Applying Ingress..."
kubectl apply -f "${REPO_ROOT}/k8s/ingress/"

log "Deployment complete."
echo ""
echo "Endpoints (add /etc/hosts entries if not done by create-cluster.sh):"
echo "  Order API:    http://api.eventcart.local/orders"
echo "  Grafana:      http://grafana.eventcart.local  (admin / eventcart-grafana-admin)"
echo "  Prometheus:   http://prometheus.eventcart.local"
echo "  Kafka UI:     http://kafka-ui.eventcart.local"
echo ""
kubectl get pods,svc,ingress -n eventcart
