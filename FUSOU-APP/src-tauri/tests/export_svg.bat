@echo off
setlocal enabledelayedexpansion

SET CURRENTDIR=%cd%

for /r %CURRENTDIR%\tests\struct_dependency_dot %%i in (*.dot) do (
    SET FILE_PATH_DOT=%%i
    SET FILE_PATH_SVG=!FILE_PATH_DOT:struct_dependency_dot=struct_dependency_svg!
    SET FILE_PATH_SVG=!FILE_PATH_SVG:.dot=.svg!
    del !FILE_PATH_SVG!
    dot -Tsvg !FILE_PATH_DOT! > !FILE_PATH_SVG!
)

for /r %CURRENTDIR%\tests\database_dependency_dot %%i in (*.dot) do (
    SET FILE_PATH_DOT=%%i
    SET FILE_PATH_SVG=!FILE_PATH_DOT:database_dependency_dot=database_dependency_svg!
    SET FILE_PATH_SVG=!FILE_PATH_SVG:.dot=.svg!
    del !FILE_PATH_SVG!
    dot -Tsvg !FILE_PATH_DOT! > !FILE_PATH_SVG!
)

SET CURRENTDIR=
SET FILE_PATH_DOT=
SET FILE_PATH_SVG=