using UnrealBuildTool;

public class Img2UmgEditor : ModuleRules
{
    public Img2UmgEditor(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "UMG"
        });

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "AssetRegistry",
            "AssetTools",
            "DesktopPlatform",
            "Json",
            "JsonUtilities",
            "Kismet",
            "KismetCompiler",
            "Projects",
            "Slate",
            "SlateCore",
            "ToolMenus",
            "UnrealEd",
            "UMGEditor"
        });
    }
}
