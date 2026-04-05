import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AuthFooter from "@/components/AuthFooter";
import PasswordSignInForm from "@/components/PasswordSignInForm";
import { useInstance } from "@/contexts/InstanceContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { ROUTES } from "@/router/routes";
import { AUTH_REDIRECT_PARAM, getSafeRedirectPath } from "@/utils/auth-redirect";
import { useTranslate } from "@/utils/i18n";

const SignIn = () => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const { generalSetting: instanceGeneralSetting } = useInstance();
  const [searchParams] = useSearchParams();
  const redirectTarget = getSafeRedirectPath(searchParams.get(AUTH_REDIRECT_PARAM));
  const signUpPath = searchParams.toString() ? `${ROUTES.AUTH}/signup?${searchParams.toString()}` : `${ROUTES.AUTH}/signup`;

  useEffect(() => {
    if (currentUser?.name) {
      window.location.href = redirectTarget || ROUTES.ROOT;
    }
  }, [currentUser, redirectTarget]);

  return (
    <div className="py-4 sm:py-8 w-80 max-w-full min-h-svh mx-auto flex flex-col justify-start items-center">
      <div className="w-full py-4 grow flex flex-col justify-center items-center">
        <div className="w-full flex flex-row justify-center items-center mb-6">
          <img className="h-14 w-auto rounded-full shadow" src={instanceGeneralSetting.customProfile?.logoUrl || "/logo.webp"} alt="" />
          <p className="ml-2 text-5xl text-foreground opacity-80">{instanceGeneralSetting.customProfile?.title || "Memos"}</p>
        </div>
        {!instanceGeneralSetting.disallowPasswordAuth ? (
          <PasswordSignInForm redirectPath={redirectTarget} />
        ) : (
          <p className="w-full text-2xl mt-2 text-muted-foreground">Password auth is not allowed.</p>
        )}
        {!instanceGeneralSetting.disallowUserRegistration && !instanceGeneralSetting.disallowPasswordAuth && (
          <p className="w-full mt-4 text-sm">
            <span className="text-muted-foreground">{t("auth.sign-up-tip")}</span>
            <Link to={signUpPath} className="cursor-pointer ml-2 text-primary hover:underline" viewTransition>
              {t("common.sign-up")}
            </Link>
          </p>
        )}
      </div>
      <AuthFooter />
    </div>
  );
};

export default SignIn;
