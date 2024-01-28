using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

public class LevelMenu : MonoBehaviour
{
    [SerializeField]
    private GameObject levelMenu;
    public void OpenLevel(int levelId)
    {
        SceneManager.LoadScene(levelId, LoadSceneMode.Single);
    }
    public void OpenLevelMenu()
    {
        levelMenu.SetActive(true);
    }
    public void CloseLevelMenu()
    {
        levelMenu.SetActive(false);
    }
}
