#!/bin/bash

for f in ./tests/struct_dependency_dot/*.dot; do
    FILE_PATH_DOT=$f
    FILE_PATH_SVG=${f//dot/svg}
    rm -f $FILE_PATH_SVG
    echo "converting $FILE_PATH_DOT to $FILE_PATH_SVG"
    dot -Tsvg $FILE_PATH_DOT > $FILE_PATH_SVG
done

for f in ./tests/database_dependency_dot/*.dot; do
    FILE_PATH_DOT=$f
    FILE_PATH_SVG=${f//dot/svg}
    rm -f $FILE_PATH_SVG
    echo "converting $FILE_PATH_DOT to $FILE_PATH_SVG"
    dot -Tsvg $FILE_PATH_DOT > $FILE_PATH_SVG
done

FILE_PATH_DOT=
FILE_PATH_SVG=