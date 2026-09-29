#if WITH_DEV_AUTOMATION_TESTS

#include "Img2UmgV2Importer.h"
#include "Dom/JsonObject.h"
#include "Misc/AutomationTest.h"
#include "Misc/Base64.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/ScopeExit.h"
#include "HAL/FileManager.h"
#include "Serialization/JsonSerializer.h"

namespace Img2UmgV2Tests
{
static TSharedPtr<FJsonObject> Document()
{
    const FString Json=TEXT(R"JSON({"format":"html-umg-ir","version":2,"target":"ue-5.8.2","viewport":{"width":320,"height":200},"root":{"id":"root","kind":"panel","layout":"column","box":{"width":320,"height":200,"padding":[0,0,0,0],"margin":[0,0,0,0],"gap":0,"align":"flex-start","self":"auto","position":"flow","left":0,"top":0,"zIndex":0,"display":"visible","visibility":"visible","overflow":"visible"},"paint":{"background":"rgba(1, 2, 3, 0.5)","color":"#1234"},"children":[]},"templates":{},"collections":[],"assets":[],"fonts":[],"observations":{"root":{"x":0,"y":0,"width":320,"height":200}}})JSON");
    TSharedPtr<FJsonObject> D; FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json),D); return D;
}
static void Asset(const TSharedPtr<FJsonObject>& D,const FString& Path,const FString& Kind=TEXT("image"),const FString& Mime=TEXT("image/png"))
{
    auto A=MakeShared<FJsonObject>(); A->SetStringField(TEXT("id"),TEXT("asset")); A->SetStringField(TEXT("path"),Path); A->SetStringField(TEXT("kind"),Kind); A->SetStringField(TEXT("mime"),Mime); A->SetStringField(TEXT("sha256"),FString::ChrN(64,'0'));
    D->SetArrayField(TEXT("assets"),{MakeShared<FJsonValueObject>(A)});
}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FImg2UmgV2PreflightTest,"Img2Umg.V2.Preflight.StrictDocument",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FImg2UmgV2PreflightTest::RunTest(const FString& Parameters)
{
    using namespace Img2UmgV2Tests; FString E;
    TestTrue(TEXT("valid font-free editable panel"),FImg2UmgV2Importer::ValidateDocument(Document(),E));
    TestFalse(TEXT("null document"),FImg2UmgV2Importer::ValidateDocument(nullptr,E));
    auto D=Document(); D->SetNumberField(TEXT("version"),1); TestFalse(TEXT("V1 not accepted by V2"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); D->SetBoolField(TEXT("unknown"),true); TestFalse(TEXT("unknown root property"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); D->GetObjectField(TEXT("root"))->SetStringField(TEXT("box"),TEXT("not object")); TestFalse(TEXT("wrong box type is safe failure"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); D->GetObjectField(TEXT("root"))->GetObjectField(TEXT("box"))->SetNumberField(TEXT("zIndex"),.5); TestFalse(TEXT("fractional zIndex"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); D->GetObjectField(TEXT("root"))->GetObjectField(TEXT("box"))->SetStringField(TEXT("position"),TEXT("absolute")); TestFalse(TEXT("absolute root"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); D->GetObjectField(TEXT("root"))->SetStringField(TEXT("kind"),TEXT("text")); TestFalse(TEXT("malformed text node"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); D->GetObjectField(TEXT("root"))->SetStringField(TEXT("assetId"),TEXT("missing")); TestFalse(TEXT("assetId on non-image"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); D->GetObjectField(TEXT("observations"))->RemoveField(TEXT("root")); TestFalse(TEXT("missing actual observation"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); D->GetObjectField(TEXT("root"))->GetObjectField(TEXT("paint"))->SetStringField(TEXT("color"),TEXT("red")); TestFalse(TEXT("unsupported color syntax"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); auto Orphan=Document()->GetObjectField(TEXT("root")); D->GetObjectField(TEXT("templates"))->SetObjectField(TEXT("unused"),Orphan); TestFalse(TEXT("orphan template"),FImg2UmgV2Importer::ValidateDocument(D,E));
    for (const TCHAR* Path:{TEXT("../bad.png"),TEXT("/bad.png"),TEXT("assets/../bad.png"),TEXT("assets/%2e%2e/bad.png"),TEXT("assets\\bad.png"),TEXT("https://host/bad.png"),TEXT("assets/bad.png?x"),TEXT("assets/bad.png#x"),TEXT("assets//bad.png")})
    {
        D=Document(); Asset(D,Path); TestFalse(FString(TEXT("unsafe path: "))+Path,FImg2UmgV2Importer::ValidateDocument(D,E));
    }
    D=Document(); Asset(D,TEXT("assets/font.woff2"),TEXT("font"),TEXT("font/woff2")); TestFalse(TEXT("WOFF2 explicitly rejected"),FImg2UmgV2Importer::ValidateDocument(D,E)); TestTrue(TEXT("WOFF2 remediation provided"),E.Contains(TEXT("TTF/OTF")));
    D=Document(); D->GetObjectField(TEXT("root"))->GetObjectField(TEXT("box"))->SetNumberField(TEXT("width"),319); TestFalse(TEXT("root must match viewport"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); D->GetObjectField(TEXT("root"))->SetStringField(TEXT("id"),TEXT("bad\nname")); TestFalse(TEXT("control characters in binding IDs"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); auto Child=Document()->GetObjectField(TEXT("root")); Child->SetStringField(TEXT("id"),TEXT("ROOT"));
    D->GetObjectField(TEXT("root"))->SetArrayField(TEXT("children"),{MakeShared<FJsonValueObject>(Child)}); TestFalse(TEXT("FName case collisions rejected"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); Child=Document()->GetObjectField(TEXT("root")); Child->SetStringField(TEXT("id"),TEXT("child"));
    D->GetObjectField(TEXT("root"))->SetArrayField(TEXT("children"),{MakeShared<FJsonValueObject>(Child)});
    D->GetObjectField(TEXT("root"))->GetObjectField(TEXT("box"))->SetStringField(TEXT("visibility"),TEXT("hidden")); TestFalse(TEXT("hidden parent cannot reveal descendant"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); Asset(D,TEXT("assets/image.png")); TestTrue(TEXT("valid image declaration accepted without IO"),FImg2UmgV2Importer::ValidateDocument(D,E));
    D=Document(); Asset(D,TEXT("assets/image.png")); auto A=D->GetArrayField(TEXT("assets"))[0]; D->SetArrayField(TEXT("assets"),{A,A}); TestFalse(TEXT("duplicate asset identity"),FImg2UmgV2Importer::ValidateDocument(D,E));
    return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FImg2UmgV2PackageTest,"Img2Umg.V2.Preflight.PackageBytes",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FImg2UmgV2PackageTest::RunTest(const FString& Parameters)
{
    using namespace Img2UmgV2Tests;
    const FString Directory=FPaths::Combine(FPaths::ProjectSavedDir(),TEXT("Img2UmgTests"),FGuid::NewGuid().ToString(EGuidFormats::Digits));
    if (!TestTrue(TEXT("create private fixture directory"),IFileManager::Get().MakeDirectory(*Directory,true))) return false;
    ON_SCOPE_EXIT { IFileManager::Get().DeleteDirectory(*Directory,false,true); };
    const FString File=FPaths::Combine(Directory,TEXT("ui.ir.json"));
    const FString ImageFile=FPaths::Combine(Directory,TEXT("image.png"));
    auto D=Document(); Asset(D,TEXT("image.png"));
    auto A=D->GetArrayField(TEXT("assets"))[0]->AsObject();
    A->SetStringField(TEXT("sha256"),TEXT("cbb328e137bd82a3d64d4728344fa9376543a2f2b76f4875c6c7012bdba97885"));
    TArray<uint8> Bytes;
    if (!TestTrue(TEXT("decode known 40x40 PNG"),FBase64::Decode(TEXT("iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAAR0lEQVR4nO3OQREAEAAEQEnU0MBHU8HUIIU5Y/ax/y21jf2ykg4ICqYDgvFgn+sqQUFBQUFBQUFBQUFBQUFBQcGXg2mCgmmC3wcPMgHb9V1ZRQAAAAAASUVORK5CYII="),Bytes))) return false;
    if (!TestTrue(TEXT("write PNG"),FFileHelper::SaveArrayToFile(Bytes,*ImageFile))) return false;
    auto SaveDocument=[&]()
    {
        FString Json;
        return FJsonSerializer::Serialize(D.ToSharedRef(),TJsonWriterFactory<>::Create(&Json)) && FFileHelper::SaveStringToFile(Json,*File);
    };
    if (!TestTrue(TEXT("write IR"),SaveDocument())) return false;
    FString E;
    TestTrue(TEXT("valid package image/hash/decode"),FImg2UmgV2Importer::ValidatePackage(File,E));
    if (!E.IsEmpty()) AddInfo(E);
    A->SetStringField(TEXT("sha256"),FString::ChrN(64,'0'));
    if (!TestTrue(TEXT("write wrong hash"),SaveDocument())) return false;
    TestFalse(TEXT("wrong image hash rejected"),FImg2UmgV2Importer::ValidatePackage(File,E));
    TestTrue(TEXT("hash error context"),E.Contains(TEXT("SHA256")));
    IFileManager::Get().Delete(*ImageFile);
    TestFalse(TEXT("missing image rejected"),FImg2UmgV2Importer::ValidatePackage(File,E));
    D=Document(); FString Json; FJsonSerializer::Serialize(D.ToSharedRef(),TJsonWriterFactory<>::Create(&Json));
    Json=TEXT("{\"version\":2,")+Json.Mid(1);
    if (!TestTrue(TEXT("write duplicate key"),FFileHelper::SaveStringToFile(Json,*File))) return false;
    TestFalse(TEXT("duplicate JSON key rejected before deserialization"),FImg2UmgV2Importer::ValidatePackage(File,E));
    TestTrue(TEXT("duplicate key error context"),E.Contains(TEXT("duplicate JSON key")));
    return true;
}
#endif
