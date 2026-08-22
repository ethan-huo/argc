# Render: hq secret.render "{ file: '<path-to-this-file>' }"
# Output: sibling .npmrc (gitignored). Never commit the rendered file.

@celados:registry=https://npm.celados.com
//npm.celados.com/:_authToken={{ bw://aa17a536-ffc0-417f-b610-3f5a539e6246/password }}
