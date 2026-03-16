# chrome-extension-disable-colab-ai
Chrome extension to disable AI features in Google Colab

Update Workflow
-git clone the repo and cd to git project root directory
-Update source code e.g. ./extension/content.js,content.css,etc.
-Put extension.pem from e.g. bitwarden into root dir
-Note: if not already present, the "key" val in ./extension/manifest.json is the pub key extracted
from our private key i.e. extension.pem via $ openssl rsa -in extension.pem  -pubout -outform DER | base64 -w0
-Update version in ./extension/manifest.json to e.g. 1.0.2
-Make a new directory for the new version e.g. ./dist/1.0.2
-Pack the updated extension using pack-extension.sh
-Move the newly generated packed extension i.e. extenion.crx to e.g. ./dist/1.0.2/
-Update ./updates.xml with the latest url e.g. https://zwhite-pgusd.github.io/chrome-extension-disable-colab-ai/dist/1.0.2/extension.crx
-Git add and git push to remote, then wait for github pages to autodeploy the new version
