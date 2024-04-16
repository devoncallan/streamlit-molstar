set -ex
export NODE_OPTIONS="--openssl-legacy-provider"
export BROWSER=none
(cd streamlit_molstar/frontend && npm i --legacy-peer-deps && npm run start)
