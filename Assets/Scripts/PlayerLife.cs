using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

public class PlayerLife : MonoBehaviour
{
    public void GotoVillage()
    {
        Debug.Log("GotoVillage");
        SceneManager.LoadScene(1, LoadSceneMode.Single);
    }
}
