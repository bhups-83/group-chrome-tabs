#!/bin/bash
rm -f tabstract.zip
zip -r tabstract.zip . -x '.git/*' '.gitignore' '*.DS_Store' '*.zip' '*.sh' 'marketing/*' '*.md'