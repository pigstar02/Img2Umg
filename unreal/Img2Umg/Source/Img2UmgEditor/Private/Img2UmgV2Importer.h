#pragma once

#include "CoreMinimal.h"

class FJsonObject;

/** Separate, fail-closed V2 importer. Never dispatches to or changes the V1 importer. */
class FImg2UmgV2Importer
{
public:
    /** FilePath is ui.ir.json (or the directory containing it). */
    bool ImportPackage(const FString& FilePath, FString& OutError);
    const FString& GetOutputPath() const { return OutputPath; }

    /** Pure shape, semantic and supported-lowering checks; creates no UObjects/assets. */
    static bool ValidateDocument(const TSharedPtr<FJsonObject>& Document, FString& OutError);
    /** Also checks contained non-symlink asset paths, bytes and SHA256 before importing anything. */
    static bool ValidatePackage(const FString& FilePath, FString& OutError);

private:
    FString OutputPath;
};
