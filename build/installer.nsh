; S-217 更新 / 重装时沿用历史安装范围与安装路径
;
; 背景：用户首次安装时选了「所有用户」或自定义了安装目录，后续更新安装仍会弹出
; 安装范围选择页；若在这一页误选「当前用户」，HKCU 下没有 InstallLocation 记录，
; 安装器只能退回默认推荐路径，于是同一台机器上出现第二份安装。
;
; electron-builder 模板其实已经完成了两件事：
;   1) initMultiUser（.onInit 阶段，assistedInstaller.nsh:108-152）读 HKLM / HKCU
;      的 InstallLocation，单侧已安装时直接调用 setInstallModePerAllUsers 或
;      setInstallModePerUser；这两个宏内部会把 $INSTDIR 回填成注册表里的历史路径
;      （multiUser.nsh:26-28 / :75-77）。
;   2) multiUserUi.nsh:39-43 在范围选择页的回调里留了 customInstallMode 钩子，
;      把 $isForceMachineInstall / $isForceCurrentInstall 置 1，该页就会直接 Abort。
;
; 因此这里只需要处理「单侧已安装」的情况：置位对应的 isForce* 变量，
; 安装范围页被跳过，$INSTDIR 保持 initMultiUser 恢复出来的历史值。
; 两侧都有安装记录、或两侧都没有（首次安装）时不置位，保留原有的选择行为。

!macro customInstallMode
  ${if} $hasPerMachineInstallation == "1"
  ${andif} $hasPerUserInstallation == "0"
    StrCpy $isForceMachineInstall "1"
  ${elseif} $hasPerUserInstallation == "1"
  ${andif} $hasPerMachineInstallation == "0"
    StrCpy $isForceCurrentInstall "1"
  ${endif}
!macroend
